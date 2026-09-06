-- Postgres forbids using a newly added enum value in the same transaction
-- that added it. This ALTER TYPE is its own migration; the backfill that
-- inserts UserFeatureFlag rows for the new value lives in the next migration.
ALTER TYPE "FeatureKey" ADD VALUE 'quotes';