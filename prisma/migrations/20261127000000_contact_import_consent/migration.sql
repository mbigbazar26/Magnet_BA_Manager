ALTER TABLE "Contact" ADD COLUMN "consentStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "consentUpdatedAt" TIMESTAMP(3);

UPDATE "Contact" SET "consentStatus" = CASE WHEN "consent" THEN 'OPTED_IN'
  WHEN EXISTS (SELECT 1 FROM "Message" WHERE "Message"."phone" = "Contact"."phone"
    AND "Message"."direction" = 'IN' AND lower(trim("Message"."body")) IN ('stop', 'unsubscribe')) THEN 'OPTED_OUT'
  ELSE 'PENDING' END,
  "consentUpdatedAt" = COALESCE("consentAt", "updatedAt");

ALTER TABLE "Contact" ADD CONSTRAINT "Contact_consentStatus_check" CHECK ("consentStatus" IN ('PENDING', 'OPTED_IN', 'OPTED_OUT'));
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_consent_consistency_check" CHECK ("consent" = ("consentStatus" = 'OPTED_IN'));

ALTER TABLE "Message" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'STANDARD', ADD COLUMN "consentRequest" JSONB;

CREATE TABLE "ConsentSettings" (
  "id" TEXT NOT NULL DEFAULT 'main', "templateId" TEXT, "acceptButton" INTEGER, "declineButton" INTEGER,
  "acceptWords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "declineWords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConsentSettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConsentSettings_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE "ConsentEvent" (
  "id" TEXT NOT NULL, "contactId" TEXT NOT NULL, "status" TEXT NOT NULL, "source" TEXT NOT NULL,
  "messageId" TEXT, "occurredAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsentEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConsentEvent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ConsentEvent_messageId_key" ON "ConsentEvent"("messageId");
CREATE INDEX "ConsentEvent_contactId_occurredAt_idx" ON "ConsentEvent"("contactId", "occurredAt");
