-- Correct the attendees column comment: it still described the old
-- {tier, is_new_member} shape. The app has stored {type, participation,
-- isNewMember, ...} since before this migration history began (see the
-- update_attendee_counts trigger in the baseline migration, which already
-- reads type/participation). Comment-only change, no behavioral effect —
-- used as a smoke test for the CI migration pipeline (squawk/backup/push).
COMMENT ON COLUMN public.user_parties.attendees IS
  'Array of objects: [{"name": "...", "type": "Adult" | "Teenager" | "Kid", "participation": "Whole" | "Main" | "After-Party", "isNewMember": boolean}]';
