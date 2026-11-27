export type ContactGroup = { id: string; name: string; contactCount?: number; systemKey?: string|null };
export type Contact = { id: string; name: string; phone: string; consent: boolean; consentStatus: 'PENDING'|'OPTED_IN'|'OPTED_OUT'; consentUpdatedAt:string|null; consentAt: string | null; updatedAt: string; createdAt: string; groups: ContactGroup[] };
export type Template = { id: string; name: string; language: string; category: string; body: string; status: string; parameters: number; supported: boolean; imageHeader: boolean; quickReplies:string[]; footer:string };
export type Message = { id: string; phone: string; direction: "IN" | "OUT"; status: string; error: string | null; body: string; createdAt: string; updatedAt: string };
export type Setup = { phoneNumberId: string; accountId: string; version: string; hasToken: boolean; hasAppSecret: boolean; hasVerifyToken: boolean };
export type ConsentSettings = {templateId:string|null;acceptButton:number|null;declineButton:number|null;acceptWords:string[];declineWords:string[]};
export type DeskState = { contacts: Contact[]; groups: ContactGroup[]; templates: Template[]; messages: Message[]; setup: Setup;consentSettings:ConsentSettings|null };
export type Action = (action: string, body: unknown, success: string) => Promise<boolean>;
export type View = "Overview" | "Messages" | "Contacts" | "Templates" | "Compose" | "Setup";
