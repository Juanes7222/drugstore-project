export { NotificationsModule } from './notifications.module';
export { MailService } from './mail.service';
export { MailTemplatesService } from './mail-templates.service';
export { EMAILS_QUEUE, MAIL_PROVIDER } from './mail.port';
export type { MailProvider, MailTemplate } from './mail.port';
export type { EmailJobData } from './mail.types';
