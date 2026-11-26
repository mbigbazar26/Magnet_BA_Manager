export type ContactGroup = { id: string; name: string; contactCount?: number };
export type Contact = { id: string; name: string; phone: string; consent: boolean; consentAt: string | null; updatedAt: string; createdAt: string; groups: ContactGroup[] };
export type Template = { id: string; name: string; language: string; category: string; body: string; status: string; parameters: number; supported: boolean };
export type Message = { id: string; phone: string; direction: "IN" | "OUT"; status: string; error: string | null; body: string; createdAt: string; updatedAt: string };
export type Setup = { phoneNumberId: string; accountId: string; version: string; hasToken: boolean; hasAppSecret: boolean; hasVerifyToken: boolean };
export type DeskState = { contacts: Contact[]; groups: ContactGroup[]; templates: Template[]; messages: Message[]; setup: Setup };
export type Action = (action: string, body: unknown, success: string) => Promise<boolean>;
export type View = "Overview" | "Messages" | "Contacts" | "Templates" | "Compose" | "Setup";
