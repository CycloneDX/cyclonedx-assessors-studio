/**
 * Unit tests for email templates.
 *
 * Verifies subject, body content, link construction, and footer
 * rendering for every mapped event type.
 */

import { describe, it, expect } from 'vitest';
import {
  assessmentCreatedTemplate,
  assessmentReadyForReviewTemplate,
  assessmentCompletedTemplate,
  assessmentAssignedTemplate,
  evidenceCreatedTemplate,
  evidenceReadyForReviewTemplate,
  evidenceApprovedTemplate,
  evidenceRejectedTemplate,
  attestationCreatedTemplate,
  webhookDisabledTemplate,
} from '../../events/channels/email-templates.js';

const APP_URL = 'https://studio.example.com';

describe('Email Templates', () => {
  // -----------------------------------------------------------------------
  // Assessment templates
  // -----------------------------------------------------------------------

  describe('assessmentCreatedTemplate', () => {
    it('should render correct subject and body', () => {
      const result = assessmentCreatedTemplate(
        { assessmentTitle: 'Q1 Review', projectName: 'Product Security', actorName: 'Jane Smith' },
        APP_URL,
      );

      expect(result.subject).toBe('Assessment "Q1 Review" created in "Product Security"');
      expect(result.text).toContain('Q1 Review');
      expect(result.text).toContain('Product Security');
      expect(result.text).toContain('Jane Smith');
      expect(result.text).toContain(`${APP_URL}/assessments`);
      expect(result.text).toContain('notification preferences');
    });

    it('should render HTML variant with action button', () => {
      const result = assessmentCreatedTemplate(
        { assessmentTitle: 'Q1 Review', projectName: 'Security', actorName: 'Jane' },
        APP_URL,
      );

      expect(result.html).toContain('<strong>"Q1 Review"</strong>');
      expect(result.html).toContain('View this assessment');
      expect(result.html).toContain(`${APP_URL}/assessments`);
    });

    it('should fall back gracefully without APP_URL', () => {
      const result = assessmentCreatedTemplate(
        { assessmentTitle: 'Test', projectName: 'Proj', actorName: 'User' },
        undefined,
      );

      expect(result.text).toContain('https://studio.example.com/assessments');
    });

    it('should handle missing actor name', () => {
      const result = assessmentCreatedTemplate(
        { assessmentTitle: 'Test', projectName: 'Proj' },
        APP_URL,
      );

      expect(result.text).toContain('Unknown');
    });
  });

  describe('assessmentReadyForReviewTemplate', () => {
    it('should include assessment ID in link', () => {
      const result = assessmentReadyForReviewTemplate(
        { assessmentTitle: 'Review Me', projectName: 'Proj', assessmentId: 'abc-123' },
        APP_URL,
      );

      expect(result.subject).toBe('Assessment "Review Me" is ready for review');
      expect(result.text).toContain(`${APP_URL}/assessments/abc-123`);
      expect(result.html).toContain(`${APP_URL}/assessments/abc-123`);
    });
  });

  describe('assessmentCompletedTemplate', () => {
    it('should render completed subject and link', () => {
      const result = assessmentCompletedTemplate(
        { assessmentTitle: 'Done', projectName: 'Proj', assessmentId: 'xyz-789' },
        APP_URL,
      );

      expect(result.subject).toBe('Assessment "Done" has been completed');
      expect(result.text).toContain(`${APP_URL}/assessments/xyz-789`);
      expect(result.text).toContain('you are a member of this project');
    });
  });

  describe('assessmentAssignedTemplate', () => {
    it('should render assignment subject and link', () => {
      const result = assessmentAssignedTemplate(
        { assessmentTitle: 'Assigned', projectName: 'Proj', assessmentId: 'def-456' },
        APP_URL,
      );

      expect(result.subject).toBe('You have been assigned to assessment "Assigned"');
      expect(result.text).toContain(`${APP_URL}/assessments/def-456`);
      expect(result.text).toContain('you have been assigned');
    });
  });

  // -----------------------------------------------------------------------
  // Evidence templates
  // -----------------------------------------------------------------------

  describe('evidenceCreatedTemplate', () => {
    it('should render evidence submission details', () => {
      const result = evidenceCreatedTemplate(
        { evidenceName: 'Pen Test Report', projectName: 'Security', evidenceId: 'ev-001', submittedBy: 'Jane' },
        APP_URL,
      );

      expect(result.subject).toBe('New evidence "Pen Test Report" submitted for review');
      expect(result.text).toContain('Pen Test Report');
      expect(result.text).toContain('Jane');
      expect(result.text).toContain(`${APP_URL}/evidence/ev-001`);
    });
  });

  describe('evidenceReadyForReviewTemplate', () => {
    it('should render review request', () => {
      const result = evidenceReadyForReviewTemplate(
        { evidenceName: 'Scan Results', projectName: 'Proj', evidenceId: 'ev-002', submittedBy: 'John' },
        APP_URL,
      );

      expect(result.subject).toBe('Evidence "Scan Results" is ready for your review');
      expect(result.text).toContain(`${APP_URL}/evidence/ev-002`);
    });
  });

  describe('evidenceApprovedTemplate', () => {
    it('should render approval notification', () => {
      const result = evidenceApprovedTemplate(
        { evidenceName: 'Approved Doc', projectName: 'Proj', evidenceId: 'ev-003' },
        APP_URL,
      );

      expect(result.subject).toBe('Your evidence "Approved Doc" has been approved');
      expect(result.text).toContain('you submitted this evidence');
    });
  });

  describe('evidenceRejectedTemplate', () => {
    it('should render rejection with reason', () => {
      const result = evidenceRejectedTemplate(
        { evidenceName: 'Bad Doc', projectName: 'Proj', evidenceId: 'ev-004', rejectionReason: 'Needs more detail' },
        APP_URL,
      );

      expect(result.subject).toBe('Your evidence "Bad Doc" needs revision');
      expect(result.text).toContain('Needs more detail');
      expect(result.html).toContain('Needs more detail');
    });

    it('should handle missing rejection reason', () => {
      const result = evidenceRejectedTemplate(
        { evidenceName: 'Bad Doc', projectName: 'Proj', evidenceId: 'ev-004' },
        APP_URL,
      );

      expect(result.text).not.toContain('Feedback:');
    });
  });

  // -----------------------------------------------------------------------
  // Attestation templates
  // -----------------------------------------------------------------------

  describe('attestationCreatedTemplate', () => {
    it('should render signature request', () => {
      const result = attestationCreatedTemplate(
        { attestationId: 'att-001', projectName: 'Compliance' },
        APP_URL,
      );

      expect(result.subject).toBe('Attestation requires your signature');
      expect(result.text).toContain('Compliance');
      expect(result.text).toContain(`${APP_URL}/attestations/att-001`);
      expect(result.html).toContain('Sign this attestation');
    });
  });

  // -----------------------------------------------------------------------
  // System templates
  // -----------------------------------------------------------------------

  describe('webhookDisabledTemplate', () => {
    it('should render webhook disabled notification', () => {
      const result = webhookDisabledTemplate(
        { webhookName: 'CI Pipeline', consecutiveFailures: 50 },
        APP_URL,
      );

      expect(result.subject).toBe('Webhook "CI Pipeline" has been disabled');
      expect(result.text).toContain('50 failures');
      expect(result.text).toContain(`${APP_URL}/admin/webhooks`);
      expect(result.text).toContain('you are an administrator');
    });
  });

  // -----------------------------------------------------------------------
  // Footer / notification preferences link
  // -----------------------------------------------------------------------

  describe('footer links', () => {
    it('should include notification preferences link with APP_URL', () => {
      const result = assessmentCreatedTemplate(
        { assessmentTitle: 'Test', projectName: 'Proj', actorName: 'User' },
        APP_URL,
      );

      expect(result.text).toContain(`${APP_URL}/settings/notifications`);
      expect(result.html).toContain(`${APP_URL}/settings/notifications`);
    });

    it('should use fallback URL when APP_URL is undefined', () => {
      const result = assessmentCreatedTemplate(
        { assessmentTitle: 'Test', projectName: 'Proj', actorName: 'User' },
        undefined,
      );

      expect(result.text).toContain('https://studio.example.com/settings/notifications');
    });
  });
});

describe('assessmentCreatedTemplate without a project', () => {
  it('never prints "undefined" and links to the assessment', async () => {
    const { assessmentCreatedTemplate } = await import('../../events/channels/email-templates.js');
    const t = assessmentCreatedTemplate({ assessmentId: 'a1', assessmentTitle: 'Q4 review', projectName: null, actorName: 'Ana' }, 'https://hub.example');
    for (const part of [t.subject, t.text, t.html]) expect(part).not.toMatch(/undefined|null/);
    expect(t.subject).toBe('Assessment "Q4 review" created');
    expect(t.text).toContain('https://hub.example/assessments/a1');
  });
});

