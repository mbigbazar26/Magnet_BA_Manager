CREATE TABLE "Contact" (
  "id" TEXT PRIMARY KEY, "phone" TEXT NOT NULL UNIQUE, "name" TEXT NOT NULL,
  "consent" BOOLEAN NOT NULL DEFAULT false, "consentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "Template" (
  "id" TEXT PRIMARY KEY, "metaId" TEXT UNIQUE, "name" TEXT NOT NULL, "language" TEXT NOT NULL,
  "category" TEXT NOT NULL, "body" TEXT NOT NULL, "status" TEXT NOT NULL, "components" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Template_name_language_key" UNIQUE ("name", "language")
);
CREATE TABLE "Message" (
  "id" TEXT PRIMARY KEY, "requestId" TEXT UNIQUE, "metaId" TEXT UNIQUE, "direction" TEXT NOT NULL,
  "phone" TEXT NOT NULL, "body" TEXT NOT NULL, "status" TEXT NOT NULL, "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "Message_phone_createdAt_idx" ON "Message"("phone", "createdAt");
CREATE INDEX "Message_createdAt_idx" ON "Message"("createdAt");

