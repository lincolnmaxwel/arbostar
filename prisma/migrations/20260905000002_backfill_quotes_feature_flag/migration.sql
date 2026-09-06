-- Quotes were always enabled before this migration (hardcoded server-side).
-- Give every existing user an enabled quotes flag row so the switch to
-- per-user control starts from "on" instead of silently revoking access for
-- every current account. Users created after deploy get their rows via the
-- admin API / upsert paths, which default to disabled.
INSERT INTO "UserFeatureFlag" ("id", "userId", "feature", "enabled")
SELECT gen_random_uuid()::text, u."id", 'quotes', true
FROM "User" u
ON CONFLICT ("userId", "feature") DO NOTHING;