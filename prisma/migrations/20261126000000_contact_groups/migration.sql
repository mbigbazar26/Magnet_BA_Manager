CREATE TABLE "ContactGroup" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContactGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContactGroup_name_key" ON "ContactGroup"("name");

CREATE TABLE "ContactGroupMembership" (
  "contactId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContactGroupMembership_pkey" PRIMARY KEY ("contactId", "groupId")
);

CREATE INDEX "ContactGroupMembership_groupId_idx" ON "ContactGroupMembership"("groupId");

ALTER TABLE "ContactGroupMembership" ADD CONSTRAINT "ContactGroupMembership_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactGroupMembership" ADD CONSTRAINT "ContactGroupMembership_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "ContactGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
