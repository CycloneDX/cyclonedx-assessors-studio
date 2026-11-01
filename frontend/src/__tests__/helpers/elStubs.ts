/**
 * Element Plus is not installed in unit tests. Mounting a real view leaves
 * its el-* components unresolved, and Vue then invokes their scoped slots
 * with no props: `<el-table-column #default="{ row }">` throws on the
 * destructure. Stubbing them as `true` renders a placeholder without
 * calling the slots, so a view mounts and its script can be driven
 * through `wrapper.vm`.
 *
 *   mount(View, { shallow: true, global: { stubs: elStubs } })
 */
export const elStubs: Record<string, true> = Object.fromEntries(
  [
    'ElAlert', 'ElButton', 'ElCheckbox', 'ElCheckboxGroup', 'ElCollapse', 'ElCollapseItem',
    'ElDialog', 'ElForm', 'ElFormItem', 'ElIcon', 'ElInput', 'ElOption', 'ElPagination',
    'ElSelect', 'ElSwitch', 'ElTabPane', 'ElTable', 'ElTableColumn', 'ElTabs', 'ElTag',
  ].map((name) => [name, true]),
)
