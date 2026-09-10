import {
  renderTaskAssignedEmail,
  taskEmailDetails,
} from './task-email-templates';

describe('task email details', () => {
  it('includes the description and ready managed files', () => {
    const details = taskEmailDetails({
      descriptionText: 'Install the approved window package.',
      attachments: ['legacy/old-plan.pdf'],
      managedFiles: [
        { status: 'ready', fileName: 'approved-plan.pdf' },
        { status: 'pending', fileName: 'uploading-plan.pdf' },
      ],
    });

    expect(details).toEqual({
      description: 'Install the approved window package.',
      attachments: [
        { fileName: 'approved-plan.pdf' },
        { fileName: 'old-plan.pdf' },
      ],
    });
  });

  it('renders details and escapes user content in both email bodies', () => {
    const email = renderTaskAssignedEmail({
      taskTitle: '<Task>',
      taskId: 43,
      taskUrl: 'https://app.marosconstruction.com/tasks?task=43',
      taskDetails: {
        description: '<script>alert(1)</script>',
        attachments: [{ fileName: 'permit-plan.pdf' }],
      },
    });

    expect(email.text).toContain('https://app.marosconstruction.com/tasks?task=43');
    expect(email.text).toContain('permit-plan.pdf');
    expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(email.html).toContain('permit-plan.pdf');
    expect(email.html).not.toContain('<script>alert(1)</script>');
  });
});
