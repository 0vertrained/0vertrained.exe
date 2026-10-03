-- jsonb_deep_merge(a, b): objects merge recursively, arrays and scalars in b
-- replace, a JSON null in b deletes the key. Mirrors patchSettings() in
-- src/data/settings.ts.
create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;
select plan(18);

select is(
  public.jsonb_deep_merge('{"a":{"x":1,"y":2},"b":1}', '{"a":{"y":3,"z":4}}'),
  '{"a":{"x":1,"y":3,"z":4},"b":1}'::jsonb,
  'nested objects merge key by key');

select is(
  public.jsonb_deep_merge('{"a":{"b":{"c":1,"d":2}}}', '{"a":{"b":{"d":null,"e":3}}}'),
  '{"a":{"b":{"c":1,"e":3}}}'::jsonb,
  'merge recurses three levels deep and deletes a nested key');

select is(
  public.jsonb_deep_merge('{"arr":[1,2,3],"k":1}', '{"arr":[9]}'),
  '{"arr":[9],"k":1}'::jsonb,
  'an array in b replaces the array in a (no element merge)');

select is(
  public.jsonb_deep_merge('{"k":1}', '{"k":"s"}'),
  '{"k":"s"}'::jsonb,
  'a scalar in b replaces a scalar in a');

select is(
  public.jsonb_deep_merge('{"o":{"x":1}}', '{"o":5}'),
  '{"o":5}'::jsonb,
  'a scalar in b replaces an object in a');

select is(
  public.jsonb_deep_merge('{"o":5}', '{"o":{"x":1,"y":null}}'),
  '{"o":{"x":1}}'::jsonb,
  'an object in b replaces a scalar in a, with its nulls stripped');

select is(
  public.jsonb_deep_merge('{"a":1,"b":2}', '{"a":null}'),
  '{"b":2}'::jsonb,
  'a JSON null in b deletes the key');

select is(
  public.jsonb_deep_merge('{"a":{"x":1,"y":2}}', '{"a":{"x":null}}'),
  '{"a":{"y":2}}'::jsonb,
  'a nested JSON null deletes the nested key');

select is(
  public.jsonb_deep_merge('{}', '{"a":null}'),
  '{}'::jsonb,
  'deleting a missing key is a no-op');

select is(
  public.jsonb_deep_merge('{"a":1}', '{}'),
  '{"a":1}'::jsonb,
  'an empty patch changes nothing');

select is(
  public.jsonb_deep_merge('{"a":1}', '[1]'),
  '[1]'::jsonb,
  'a non-object b (array) replaces a outright');

select is(
  public.jsonb_deep_merge('{"a":1}', '5'),
  '5'::jsonb,
  'a non-object b (scalar) replaces a outright');

select is(
  public.jsonb_deep_merge('{"a":1}', null),
  '{"a":1}'::jsonb,
  'a SQL-null b leaves a unchanged');

select is(
  public.jsonb_deep_merge(null, '{"a":1,"b":null}'),
  '{"a":1}'::jsonb,
  'a SQL-null a is treated as {} (and b''s nulls are stripped)');

select is(
  public.jsonb_deep_merge('[1,2]', '{"a":1}'),
  '{"a":1}'::jsonb,
  'a non-object a is treated as {}');

select is(
  public.jsonb_deep_merge('{"keep":true,"a":{"keep":1}}', '{"a":{"new":2},"other":3}'),
  '{"keep":true,"a":{"keep":1,"new":2},"other":3}'::jsonb,
  'keys b does not mention survive at every level');

-- The SettingsV2 shape the client actually sends.
select is(
  public.jsonb_deep_merge(
    '{"v":2,"units":"metric","onboarded":false,"profile":{},"session":{"restSeconds":90,"sound":true,"haptics":true,"cues":true},"game":{"pauses":[{"from":"2026-01-01","to":"2026-01-03","reason":"sick"}]}}',
    '{"units":"imperial","onboarded":true,"profile":{"name":"Al"},"session":{"restSeconds":120},"game":{"pauses":[],"title":null}}'),
  '{"v":2,"units":"imperial","onboarded":true,"profile":{"name":"Al"},"session":{"restSeconds":120,"sound":true,"haptics":true,"cues":true},"game":{"pauses":[]}}'::jsonb,
  'a SettingsV2 patch: nested merge, array replace, null delete');

-- Immutable means the planner may fold it; it must not depend on anything
-- but its arguments.
select is(
  public.jsonb_deep_merge('{"a":{"b":1}}', '{"a":{"c":2}}'),
  public.jsonb_deep_merge('{"a":{"b":1}}', '{"a":{"c":2}}'),
  'deterministic for the same inputs');

select * from finish();
rollback;
