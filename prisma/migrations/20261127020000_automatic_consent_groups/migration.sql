-- Keep one automatic group for every consent state, adopting any existing names.
INSERT INTO "ContactGroup" ("id", "name", "systemKey", "updatedAt")
VALUES ('system_opted_out_customers', 'Opted-out customers', 'OPTED_OUT', CURRENT_TIMESTAMP),
       ('system_awaiting_response', 'Awaiting response', 'PENDING', CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "systemKey" = EXCLUDED."systemKey";

-- Replace the existing trigger function so older and newer app versions both
-- move a contact between the three groups atomically with each consent update.
CREATE OR REPLACE FUNCTION public.sync_contact_opted_in_group() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE target_group TEXT;
BEGIN
  SELECT "id" INTO target_group FROM public."ContactGroup" WHERE "systemKey" = NEW."consentStatus";
  IF target_group IS NULL THEN RETURN NEW; END IF;
  DELETE FROM public."ContactGroupMembership" m USING public."ContactGroup" g
  WHERE m."contactId" = NEW."id" AND m."groupId" = g."id"
    AND g."systemKey" IN ('OPTED_IN', 'OPTED_OUT', 'PENDING') AND g."id" <> target_group;
  INSERT INTO public."ContactGroupMembership" ("contactId", "groupId")
  VALUES (NEW."id", target_group) ON CONFLICT ("contactId", "groupId") DO NOTHING;
  RETURN NEW;
END;
$$;

-- Reconcile contacts who had already replied or were imported before this upgrade.
DELETE FROM "ContactGroupMembership" m USING "ContactGroup" g, "Contact" c
WHERE m."groupId" = g."id" AND m."contactId" = c."id"
  AND g."systemKey" IN ('OPTED_IN', 'OPTED_OUT', 'PENDING') AND g."systemKey" <> c."consentStatus";
INSERT INTO "ContactGroupMembership" ("contactId", "groupId")
SELECT c."id", g."id" FROM "Contact" c JOIN "ContactGroup" g ON g."systemKey" = c."consentStatus"
WHERE g."systemKey" IN ('OPTED_IN', 'OPTED_OUT', 'PENDING')
ON CONFLICT ("contactId", "groupId") DO NOTHING;
