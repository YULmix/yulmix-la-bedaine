-- Feature #9: Floating Feedback Drawer & Global Resolution Banner
--
-- 1. A public "feedback" storage bucket so pasted screenshots can be uploaded by any
--    authenticated user and referenced by a plain public URL in app_feedback.screenshot_url.
-- 2. A SECURITY DEFINER function exposing only the latest resolution timestamp across all
--    app_feedback rows. RLS on app_feedback restricts SELECT to admins and the feedback's own
--    author (see baseline "App Feedback: Users can read own feedback" policy), so a regular
--    member cannot query the table directly to know whether *someone else's* feedback was
--    resolved. This function lets every authenticated user learn "has anything been resolved
--    since I last checked" without exposing any feedback content.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback', 'feedback', true, 5242880, array['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
on conflict (id) do nothing;

create policy "Feedback bucket: authenticated users can upload"
on storage.objects for insert
to authenticated
with check (bucket_id = 'feedback');

create or replace function public.get_latest_feedback_resolution()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select max(resolved_at) from public.app_feedback where is_resolved = true;
$$;

alter function public.get_latest_feedback_resolution() owner to postgres;

grant execute on function public.get_latest_feedback_resolution() to authenticated;

-- The baseline "App Feedback: Users can update own feedback" RLS policy lets a feedback
-- author update their own row, with no column-level restriction — so without this trigger,
-- any member could set is_resolved = true on their own feedback and (now that resolution is
-- broadcast globally via get_latest_feedback_resolution()) trigger the refresh banner for
-- every user. Resolution must stay an admin-only action. Same "ignore client value, recompute
-- server-side" pattern as calculated_amount_owed (see enforce_calculated_amount_owed()).
create or replace function public.enforce_feedback_resolution_admin_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    new.is_resolved := old.is_resolved;
    new.resolved_at := old.resolved_at;
  end if;
  return new;
end;
$$;

alter function public.enforce_feedback_resolution_admin_only() owner to postgres;

create trigger trg_enforce_feedback_resolution_admin_only
before update on public.app_feedback
for each row execute function public.enforce_feedback_resolution_admin_only();
