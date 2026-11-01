/**
 * Email templates for the email notification channel.
 *
 * Each template function returns { subject, text, html } for an event
 * type. Templates produce clean plain text and a minimal HTML
 * alternative with inline CSS, no images, and no tracking.
 */

export interface EmailTemplate {
  subject: string;
  text: string;
  html: string;
}

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------

/**
 * HTML that is already safe to insert as-is. Only htmlFragment creates it,
 * so every SafeHtml was built with its own values escaped.
 */
class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Tagged template for email HTML: every interpolated value is escaped
 * unless it is a SafeHtml from another htmlFragment. Titles, evidence
 * names and actor names are user-controlled and used to land in the HTML
 * raw, so a crafted name became a phishing link from the trusted sender
 * (security review X3).
 */
function htmlFragment(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = '';
  strings.forEach((part, i) => {
    out += part;
    if (i < values.length) {
      const v = values[i];
      out += v instanceof SafeHtml ? v.value : escapeHtml(v);
    }
  });
  return new SafeHtml(out);
}

// ---------------------------------------------------------------------------
// Footer helpers
// ---------------------------------------------------------------------------

function getFooter(appUrl: string | undefined, reason: string): string {
  const settingsLink = appUrl
    ? `${appUrl}/settings/notifications`
    : 'https://studio.example.com/settings/notifications';

  return `---
You received this email because ${reason}.
Manage your notification preferences:
${settingsLink}`;
}

function getHtmlFooter(appUrl: string | undefined, reason: string): SafeHtml {
  const settingsLink = appUrl
    ? `${appUrl}/settings/notifications`
    : 'https://studio.example.com/settings/notifications';

  return htmlFragment`<hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">
<p style="font-size: 12px; color: #666; margin: 10px 0;">
  You received this email because ${reason}.<br/>
  <a href="${settingsLink}" style="color: #0066cc; text-decoration: none;">Manage your notification preferences</a>
</p>`;
}

function formatDate(): string {
  return new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function actionButton(href: string, label: string): SafeHtml {
  return htmlFragment`<a href="${href}" style="display: inline-block; background-color: #0066cc; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">${label}</a>`;
}

// ---------------------------------------------------------------------------
// Assessment templates
// ---------------------------------------------------------------------------

export function assessmentCreatedTemplate(
  data: Record<string, unknown>,
  appUrl: string | undefined,
): EmailTemplate {
  const { assessmentId, assessmentTitle, projectName, actorName } = data as {
    assessmentId?: string;
    assessmentTitle?: string;
    projectName?: string | null;
    actorName?: string;
  };

  // Assessments need not belong to a project.
  const where = projectName ? ` in "${projectName}"` : '';
  const subject = `Assessment "${assessmentTitle}" created${where}`;
  const base = appUrl ?? 'https://studio.example.com';
  const link = assessmentId ? `${base}/assessments/${assessmentId}` : `${base}/assessments`;

  const text = `Assessment "${assessmentTitle}" has been created${projectName ? ` in project "${projectName}"` : ''}.

Created by: ${actorName || 'Unknown'}
Date: ${formatDate()}

View this assessment:
${link}

${getFooter(appUrl, 'you are assigned to this assessment')}`;

  const inProject = projectName ? htmlFragment` in project <strong>"${projectName}"</strong>` : '';
  const html = htmlFragment`<p>Assessment <strong>"${assessmentTitle}"</strong> has been created${inProject}.</p>

<p>
  <strong>Created by:</strong> ${actorName || 'Unknown'}<br/>
  <strong>Date:</strong> ${formatDate()}
</p>

<p>${actionButton(link, 'View this assessment')}</p>

${getHtmlFooter(appUrl, 'you are assigned to this assessment')}`.value;

  return { subject, text, html };
}

export function assessmentReadyForReviewTemplate(
  data: Record<string, unknown>,
  appUrl: string | undefined,
): EmailTemplate {
  const { assessmentTitle, projectName, assessmentId } = data as {
    assessmentTitle?: string;
    projectName?: string;
    assessmentId?: string;
  };

  const subject = `Assessment "${assessmentTitle}" is ready for review`;
  const link = appUrl
    ? `${appUrl}/assessments/${assessmentId}`
    : 'https://studio.example.com/assessments';

  const text = `Assessment "${assessmentTitle}" is ready for your review.

Project: ${projectName || 'Unknown'}
Date: ${formatDate()}

Review this assessment:
${link}

${getFooter(appUrl, 'you are an assessor on this project')}`;

  const html = htmlFragment`<p>Assessment <strong>"${assessmentTitle}"</strong> is ready for your review.</p>

<p>
  <strong>Project:</strong> ${projectName || 'Unknown'}<br/>
  <strong>Date:</strong> ${formatDate()}
</p>

<p>${actionButton(link, 'Review this assessment')}</p>

${getHtmlFooter(appUrl, 'you are an assessor on this project')}`.value;

  return { subject, text, html };
}

export function assessmentCompletedTemplate(
  data: Record<string, unknown>,
  appUrl: string | undefined,
): EmailTemplate {
  const { assessmentTitle, projectName, assessmentId } = data as {
    assessmentTitle?: string;
    projectName?: string;
    assessmentId?: string;
  };

  const subject = `Assessment "${assessmentTitle}" has been completed`;
  const link = appUrl
    ? `${appUrl}/assessments/${assessmentId}`
    : 'https://studio.example.com/assessments';

  const text = `Assessment "${assessmentTitle}" has been completed.

Project: ${projectName || 'Unknown'}
Date: ${formatDate()}

View this assessment:
${link}

${getFooter(appUrl, 'you are a member of this project')}`;

  const html = htmlFragment`<p>Assessment <strong>"${assessmentTitle}"</strong> has been completed.</p>

<p>
  <strong>Project:</strong> ${projectName || 'Unknown'}<br/>
  <strong>Date:</strong> ${formatDate()}
</p>

<p>${actionButton(link, 'View this assessment')}</p>

${getHtmlFooter(appUrl, 'you are a member of this project')}`.value;

  return { subject, text, html };
}

export function assessmentAssignedTemplate(
  data: Record<string, unknown>,
  appUrl: string | undefined,
): EmailTemplate {
  const { assessmentTitle, projectName, assessmentId } = data as {
    assessmentTitle?: string;
    projectName?: string;
    assessmentId?: string;
  };

  const subject = `You have been assigned to assessment "${assessmentTitle}"`;
  const link = appUrl
    ? `${appUrl}/assessments/${assessmentId}`
    : 'https://studio.example.com/assessments';

  const text = `You have been assigned to assessment "${assessmentTitle}".

Project: ${projectName || 'Unknown'}
Date: ${formatDate()}

View this assessment:
${link}

${getFooter(appUrl, 'you have been assigned to this assessment')}`;

  const html = htmlFragment`<p>You have been assigned to assessment <strong>"${assessmentTitle}"</strong>.</p>

<p>
  <strong>Project:</strong> ${projectName || 'Unknown'}<br/>
  <strong>Date:</strong> ${formatDate()}
</p>

<p>${actionButton(link, 'View this assessment')}</p>

${getHtmlFooter(appUrl, 'you have been assigned to this assessment')}`.value;

  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// Evidence templates
// ---------------------------------------------------------------------------

export function evidenceCreatedTemplate(
  data: Record<string, unknown>,
  appUrl: string | undefined,
): EmailTemplate {
  const { evidenceName, projectName, evidenceId, submittedBy } = data as {
    evidenceName?: string;
    projectName?: string;
    evidenceId?: string;
    submittedBy?: string;
  };

  const subject = `New evidence "${evidenceName}" submitted for review`;
  const link = appUrl
    ? `${appUrl}/evidence/${evidenceId}`
    : 'https://studio.example.com/evidence';

  const text = `Evidence "${evidenceName}" has been submitted for your review.

Project: ${projectName || 'Unknown'}
Submitted by: ${submittedBy || 'Unknown'}
Date: ${formatDate()}

View this evidence:
${link}

${getFooter(appUrl, 'you are assigned as the reviewer for this evidence')}`;

  const html = htmlFragment`<p>Evidence <strong>"${evidenceName}"</strong> has been submitted for your review.</p>

<p>
  <strong>Project:</strong> ${projectName || 'Unknown'}<br/>
  <strong>Submitted by:</strong> ${submittedBy || 'Unknown'}<br/>
  <strong>Date:</strong> ${formatDate()}
</p>

<p>${actionButton(link, 'View this evidence')}</p>

${getHtmlFooter(appUrl, 'you are assigned as the reviewer for this evidence')}`.value;

  return { subject, text, html };
}

export function evidenceReadyForReviewTemplate(
  data: Record<string, unknown>,
  appUrl: string | undefined,
): EmailTemplate {
  const { evidenceName, projectName, evidenceId, submittedBy } = data as {
    evidenceName?: string;
    projectName?: string;
    evidenceId?: string;
    submittedBy?: string;
  };

  const subject = `Evidence "${evidenceName}" is ready for your review`;
  const link = appUrl
    ? `${appUrl}/evidence/${evidenceId}`
    : 'https://studio.example.com/evidence';

  const text = `Evidence "${evidenceName}" is ready for your review.

Project: ${projectName || 'Unknown'}
Submitted by: ${submittedBy || 'Unknown'}
Date: ${formatDate()}

View this evidence:
${link}

${getFooter(appUrl, 'you are assigned as the reviewer for this evidence')}`;

  const html = htmlFragment`<p>Evidence <strong>"${evidenceName}"</strong> is ready for your review.</p>

<p>
  <strong>Project:</strong> ${projectName || 'Unknown'}<br/>
  <strong>Submitted by:</strong> ${submittedBy || 'Unknown'}<br/>
  <strong>Date:</strong> ${formatDate()}
</p>

<p>${actionButton(link, 'View this evidence')}</p>

${getHtmlFooter(appUrl, 'you are assigned as the reviewer for this evidence')}`.value;

  return { subject, text, html };
}

export function evidenceApprovedTemplate(
  data: Record<string, unknown>,
  appUrl: string | undefined,
): EmailTemplate {
  const { evidenceName, projectName, evidenceId } = data as {
    evidenceName?: string;
    projectName?: string;
    evidenceId?: string;
  };

  const subject = `Your evidence "${evidenceName}" has been approved`;
  const link = appUrl
    ? `${appUrl}/evidence/${evidenceId}`
    : 'https://studio.example.com/evidence';

  const text = `Your evidence "${evidenceName}" has been approved.

Project: ${projectName || 'Unknown'}
Date: ${formatDate()}

View this evidence:
${link}

${getFooter(appUrl, 'you submitted this evidence')}`;

  const html = htmlFragment`<p>Your evidence <strong>"${evidenceName}"</strong> has been approved.</p>

<p>
  <strong>Project:</strong> ${projectName || 'Unknown'}<br/>
  <strong>Date:</strong> ${formatDate()}
</p>

<p>${actionButton(link, 'View this evidence')}</p>

${getHtmlFooter(appUrl, 'you submitted this evidence')}`.value;

  return { subject, text, html };
}

export function evidenceRejectedTemplate(
  data: Record<string, unknown>,
  appUrl: string | undefined,
): EmailTemplate {
  const { evidenceName, projectName, evidenceId, rejectionReason } = data as {
    evidenceName?: string;
    projectName?: string;
    evidenceId?: string;
    rejectionReason?: string;
  };

  const subject = `Your evidence "${evidenceName}" needs revision`;
  const link = appUrl
    ? `${appUrl}/evidence/${evidenceId}`
    : 'https://studio.example.com/evidence';

  const text = `Your evidence "${evidenceName}" needs revision.

Project: ${projectName || 'Unknown'}
Date: ${formatDate()}

${rejectionReason ? `Feedback: ${rejectionReason}\n` : ''}
View this evidence:
${link}

${getFooter(appUrl, 'you submitted this evidence')}`;

  const html = htmlFragment`<p>Your evidence <strong>"${evidenceName}"</strong> needs revision.</p>

<p>
  <strong>Project:</strong> ${projectName || 'Unknown'}<br/>
  <strong>Date:</strong> ${formatDate()}
</p>

${rejectionReason ? htmlFragment`<p><strong>Feedback:</strong> ${rejectionReason}</p>` : ''}

<p>${actionButton(link, 'View this evidence')}</p>

${getHtmlFooter(appUrl, 'you submitted this evidence')}`.value;

  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// Attestation templates
// ---------------------------------------------------------------------------

export function attestationCreatedTemplate(
  data: Record<string, unknown>,
  appUrl: string | undefined,
): EmailTemplate {
  const { attestationId, projectName } = data as {
    attestationId?: string;
    projectName?: string;
  };

  const subject = 'Attestation requires your signature';
  const link = appUrl
    ? `${appUrl}/attestations/${attestationId}`
    : 'https://studio.example.com/attestations';

  const text = `An attestation requires your signature.

Project: ${projectName || 'Unknown'}
Date: ${formatDate()}

Sign this attestation:
${link}

${getFooter(appUrl, 'you have been assigned as a signatory for this attestation')}`;

  const html = htmlFragment`<p>An attestation requires your signature.</p>

<p>
  <strong>Project:</strong> ${projectName || 'Unknown'}<br/>
  <strong>Date:</strong> ${formatDate()}
</p>

<p>${actionButton(link, 'Sign this attestation')}</p>

${getHtmlFooter(appUrl, 'you have been assigned as a signatory for this attestation')}`.value;

  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// System templates
// ---------------------------------------------------------------------------

export function webhookDisabledTemplate(
  data: Record<string, unknown>,
  appUrl: string | undefined,
): EmailTemplate {
  const { webhookName, consecutiveFailures } = data as {
    webhookName?: string;
    consecutiveFailures?: number;
  };

  const subject = `Webhook "${webhookName}" has been disabled`;
  const link = appUrl
    ? `${appUrl}/admin/webhooks`
    : 'https://studio.example.com/admin/webhooks';

  const text = `Webhook "${webhookName}" has been automatically disabled due to consecutive delivery failures (${consecutiveFailures} failures).

Date: ${formatDate()}

Manage your webhooks:
${link}

${getFooter(appUrl, 'you are an administrator')}`;

  const html = htmlFragment`<p>Webhook <strong>"${webhookName}"</strong> has been automatically disabled due to consecutive delivery failures (${consecutiveFailures} failures).</p>

<p>
  <strong>Date:</strong> ${formatDate()}
</p>

<p>${actionButton(link, 'Manage your webhooks')}</p>

${getHtmlFooter(appUrl, 'you are an administrator')}`.value;

  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// Account security
// ---------------------------------------------------------------------------

/**
 * Password reset link. Sent whatever the user's notification preferences
 * are, so it has no preferences footer.
 */
export function passwordResetTemplate(data: { resetUrl: string; expiresInMinutes: number }): EmailTemplate {
  const { resetUrl, expiresInMinutes } = data;
  const subject = 'Reset your Assessors Studio password';

  const text = `Someone asked to reset the password for your Assessors Studio account.

To choose a new password, open this link within ${expiresInMinutes} minutes:
${resetUrl}

The link works once. If you did not ask for this, ignore this email: your password stays the same.`;

  const html = htmlFragment`<p>Someone asked to reset the password for your Assessors Studio account.</p>

<p>${actionButton(resetUrl, 'Choose a new password')}</p>

<p style="font-size: 13px; color: #444;">The link expires in ${expiresInMinutes} minutes and works once. If the button does not work, copy this address into your browser:<br/>${resetUrl}</p>

<p style="font-size: 13px; color: #444;">If you did not ask for this, ignore this email: your password stays the same.</p>`.value;

  return { subject, text, html };
}
