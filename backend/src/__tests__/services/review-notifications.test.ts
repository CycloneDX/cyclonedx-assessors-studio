/**
 * Review workflow notifications. Evidence rejection resets the state to
 * in_progress, and assessments are completed into the state 'complete';
 * the email and in-app builders must recognise both.
 */
import { describe, it, expect } from 'vitest';
import { EmailChannel } from '../../events/channels/email.js';
import { buildTitle, buildMessage } from '../../events/notification-utils.js';
import type { EventEnvelope } from '../../events/types.js';

function envelope(type: string, data: Record<string, unknown>): EventEnvelope {
  return {
    id: 'evt_review', type, category: type.split('.')[0]!, timestamp: new Date().toISOString(), version: '1',
    actor: { userId: 'u1', displayName: 'Reviewer' }, data,
  } as EventEnvelope;
}

function render(env: EventEnvelope) {
  const channel = new EmailChannel(() => ({}) as never);
  return (channel as unknown as { renderTemplate(e: EventEnvelope): { subject: string; text: string } | null }).renderTemplate(env);
}

describe('evidence rejection email', () => {
  it('is sent when a reviewer sends evidence back from review, with the reason', () => {
    const t = render(envelope('evidence.state_changed', {
      evidenceId: 'e1', evidenceName: 'Pen test', previousState: 'in_review', newState: 'in_progress', rejectionReason: 'Missing scope page',
    }));
    expect(t).not.toBeNull();
    expect(t!.text).toContain('Missing scope page');
  });

  it('is not sent when evidence moves to in_progress for another reason', () => {
    const t = render(envelope('evidence.state_changed', { evidenceId: 'e1', previousState: 'new', newState: 'in_progress' }));
    expect(t).toBeNull();
  });
});

describe('assessment completion', () => {
  it.each(['complete', 'completed'])('emails and titles the %s state', (state) => {
    const env = envelope('assessment.state_changed', { assessmentId: 'a1', assessmentTitle: 'Q4 review', previousState: 'in_progress', newState: state });
    expect(render(env)?.subject).toContain('completed');
    expect(buildTitle(env)).toBe('Assessment Completed');
    expect(buildMessage(env)).toBe('Assessment "Q4 review" has been completed');
  });
});
