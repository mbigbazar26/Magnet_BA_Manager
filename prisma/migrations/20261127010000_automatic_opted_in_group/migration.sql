ALTER TABLE "ContactGroup" ADD COLUMN "systemKey" TEXT;
CREATE UNIQUE INDEX "ContactGroup_systemKey_key" ON "ContactGroup"("systemKey");

-- Adopt the group already created by an operator, preserving its ID and references.
INSERT INTO "ContactGroup" ("id", "name", "systemKey", "updatedAt")
VALUES ('system_opted_in_customers', 'Opted-in customers', 'OPTED_IN', CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "systemKey" = 'OPTED_IN';

-- Synchronize the existing group once, including contacts who opted in earlier.
DELETE FROM "ContactGroupMembership" m USING "ContactGroup" g, "Contact" c
WHERE m."groupId" = g."id" AND m."contactId" = c."id" AND g."systemKey" = 'OPTED_IN'
  AND NOT (c."consent" AND c."consentStatus" = 'OPTED_IN');
INSERT INTO "ContactGroupMembership" ("contactId", "groupId")
SELECT c."id", g."id" FROM "Contact" c CROSS JOIN "ContactGroup" g
WHERE g."systemKey" = 'OPTED_IN' AND c."consent" AND c."consentStatus" = 'OPTED_IN'
ON CONFLICT ("contactId", "groupId") DO NOTHING;

-- Keep consent and membership atomic for webhook replies, manual edits and imports.
CREATE FUNCTION public.sync_contact_opted_in_group() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE target_group TEXT;
BEGIN
  SELECT "id" INTO target_group FROM public."ContactGroup" WHERE "systemKey" = 'OPTED_IN';
  IF target_group IS NULL THEN RETURN NEW; END IF;
  IF NEW."consent" AND NEW."consentStatus" = 'OPTED_IN' THEN
    INSERT INTO public."ContactGroupMembership" ("contactId", "groupId")
    VALUES (NEW."id", target_group) ON CONFLICT ("contactId", "groupId") DO NOTHING;
  ELSE
    DELETE FROM public."ContactGroupMembership"
    WHERE "contactId" = NEW."id" AND "groupId" = target_group;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER contact_opted_in_group
AFTER INSERT OR UPDATE OF "consent", "consentStatus" ON public."Contact"
FOR EACH ROW EXECUTE FUNCTION public.sync_contact_opted_in_group();
