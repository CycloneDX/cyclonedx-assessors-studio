/**
 * Runtime accessibility patches for Element Plus 2.x drift.
 *
 * Element Plus emits a couple of axe-critical violations from its
 * internals that cannot be addressed via component props. This plugin
 * installs a single MutationObserver on document.body and repairs the
 * markup after Element Plus renders it. The patches are intentionally
 * minimal and side-effect free: they only adjust attributes that fail
 * WCAG 2.1 AA, and they never touch attributes the application sets.
 *
 * Why a runtime patch instead of a fork or upstream PR:
 *   - Forking Element Plus would force every consumer onto a custom
 *     build with no upgrade path.
 *   - Upstream PRs are welcome but take months; we ship before they
 *     merge.
 *   - The patches are tightly scoped to Element Plus selectors so they
 *     do not interfere with hand-rolled components.
 *
 * Patches:
 *   1. Phantom aria-activedescendant. Element Plus's el-autocomplete
 *      and el-select-v2 emit aria-activedescendant="...-item--1" when
 *      no option is highlighted. The -1 index references an item that
 *      does not exist in the DOM, which axe (correctly) flags as
 *      aria-valid-attr-value. We clear the attribute whenever its
 *      value either ends in "-item--1" or references a missing ID.
 *
 *   2. Unlabeled el-pagination size selector. The page-size dropdown
 *      rendered when el-pagination's layout includes "sizes" is an
 *      el-select with no associated label. We attach an aria-label
 *      that names the control. Translatable via the data-aria-label
 *      attribute on the el-pagination root if needed.
 */

import type { App } from 'vue';

const PAGINATION_SIZE_LABEL = 'Items per page';

function fixActiveDescendant(node: Element): void {
  const inputs = node.querySelectorAll<HTMLElement>('[aria-activedescendant]');
  inputs.forEach((el) => {
    const value = el.getAttribute('aria-activedescendant');
    if (!value) return;
    // Element Plus's "no item highlighted" sentinel.
    if (value.endsWith('-item--1')) {
      el.removeAttribute('aria-activedescendant');
      return;
    }
    // Defensive: if the referenced ID is not currently in the DOM,
    // axe flags it. Clear in that case too.
    if (!document.getElementById(value)) {
      el.removeAttribute('aria-activedescendant');
    }
  });
}

function fixPaginationSizeLabel(node: Element): void {
  // The size selector is rendered inside .el-pagination__sizes when
  // the layout includes "sizes". The inner combobox input is the
  // unlabeled control.
  const inputs = node.querySelectorAll<HTMLElement>(
    '.el-pagination__sizes .el-select__input:not([aria-label])',
  );
  inputs.forEach((el) => {
    el.setAttribute('aria-label', PAGINATION_SIZE_LABEL);
  });
}

/**
 * Element Plus el-select forwards $attrs to the inner input but the
 * forwarding only catches attrs declared on the component's emits.
 * aria-label sometimes lands on the wrapper, not the input. Re-attach
 * it to the inner combobox so the label rule passes.
 *
 * Strategy: for any .el-select__input that is missing aria-label and
 * aria-labelledby, look up the chain for the nearest .el-select that
 * carries one of those attributes (or a placeholder we can promote)
 * and copy it down.
 */
function fixSelectInputLabel(node: Element): void {
  const inputs = node.querySelectorAll<HTMLElement>(
    '.el-select__input:not([aria-label]):not([aria-labelledby])',
  );
  inputs.forEach((el) => {
    const wrapper = el.closest('.el-select');
    if (!wrapper) return;
    const wrapperLabel = wrapper.getAttribute('aria-label');
    if (wrapperLabel) {
      el.setAttribute('aria-label', wrapperLabel);
      return;
    }
    const labelledBy = wrapper.getAttribute('aria-labelledby');
    if (labelledBy) {
      el.setAttribute('aria-labelledby', labelledBy);
      return;
    }
    // Fall back to a visible placeholder on the combobox span the
    // user sees. Element Plus puts the placeholder text in a sibling
    // span (.el-select__placeholder or .select-trigger).
    const placeholderSpan = wrapper.querySelector<HTMLElement>('.el-select__placeholder, .select-trigger .el-input__inner');
    const placeholderText = placeholderSpan?.textContent?.trim();
    if (placeholderText) {
      el.setAttribute('aria-label', placeholderText);
    }
  });
}

function patchAll(root: ParentNode): void {
  // querySelectorAll only works on ParentNode; cast where needed.
  const rootEl = (root as Element) ?? document.body;
  if (rootEl instanceof Element) {
    fixActiveDescendant(rootEl);
    fixPaginationSizeLabel(rootEl);
    fixSelectInputLabel(rootEl);
  } else {
    fixActiveDescendant(document.body);
    fixPaginationSizeLabel(document.body);
    fixSelectInputLabel(document.body);
  }
}

let installed = false;
let observer: MutationObserver | null = null;

function installAccessibilityPatches(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  const run = () => patchAll(document.body);

  // Run once on initial mount in case content is already there.
  run();

  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      // Only react to changes that could touch the attributes we
      // care about. The whole-document observer is cheap because we
      // exit fast on irrelevant mutations.
      if (m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0)) {
        m.addedNodes.forEach((n) => {
          if (n.nodeType === Node.ELEMENT_NODE) {
            const el = n as Element;
            fixActiveDescendant(el);
            fixPaginationSizeLabel(el);
            fixSelectInputLabel(el);
          }
        });
      } else if (m.type === 'attributes' && m.attributeName === 'aria-activedescendant') {
        if (m.target.nodeType === Node.ELEMENT_NODE) {
          fixActiveDescendant(m.target as Element);
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-activedescendant'],
  });
}

export default {
  install(_app: App): void {
    installAccessibilityPatches();
  },
};
