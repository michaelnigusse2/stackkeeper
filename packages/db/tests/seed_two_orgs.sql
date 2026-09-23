-- Seed two organisations with a full set of records each.
-- Run as the migration owner, which is exempt from the policies, so that the
-- isolation test below starts from data that genuinely exists on both sides.
set client_min_messages = warning;

insert into app.organization_settings (org_id, reporting_currency) values
  ('org_a', 'USD'),
  ('org_b', 'EUR');

insert into app.client (id, org_id, name, status) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'org_a', 'Acme Bakery',   'active'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'org_b', 'Borealis Labs', 'active');

insert into app.project (id, org_id, client_id, name) values
  ('aaaaaaaa-0000-4000-8000-000000000002', 'org_a', 'aaaaaaaa-0000-4000-8000-000000000001', 'Marketing site'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'org_b', 'bbbbbbbb-0000-4000-8000-000000000001', 'Customer portal');

insert into app.asset (id, org_id, client_id, project_id, kind, label, provider, identifier, account_owner, payer) values
  ('aaaaaaaa-0000-4000-8000-000000000003', 'org_a', 'aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000002', 'domain', 'acmebakery.com', 'namecheap', 'acmebakery.com', 'agency', 'agency'),
  ('bbbbbbbb-0000-4000-8000-000000000003', 'org_b', 'bbbbbbbb-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000002', 'server', 'web-01', 'hetzner', '203.0.113.10', 'client', 'client');

insert into app.cost_line (id, org_id, asset_id, cost_amount, cost_currency, cost_cycle, charge_amount, charge_currency, charge_cycle) values
  ('aaaaaaaa-0000-4000-8000-000000000004', 'org_a', 'aaaaaaaa-0000-4000-8000-000000000003', 1200, 'USD', 'annual', 2400, 'USD', 'annual'),
  ('bbbbbbbb-0000-4000-8000-000000000004', 'org_b', 'bbbbbbbb-0000-4000-8000-000000000003', 549, 'EUR', 'monthly', null, null, null);

insert into app.credential_ref (id, org_id, client_id, asset_id, label, manager, reference) values
  ('aaaaaaaa-0000-4000-8000-000000000005', 'org_a', 'aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000003', 'Registrar login', 'onepassword', 'op://Shared/acme-namecheap/password'),
  ('bbbbbbbb-0000-4000-8000-000000000005', 'org_b', 'bbbbbbbb-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000003', 'Root SSH key', 'bitwarden', '9f1c0b3e-0000-0000-0000-000000000001');

insert into app.monitor (id, org_id, asset_id, kind, target) values
  ('aaaaaaaa-0000-4000-8000-000000000006', 'org_a', 'aaaaaaaa-0000-4000-8000-000000000003', 'domain_expiry', 'acmebakery.com'),
  ('bbbbbbbb-0000-4000-8000-000000000006', 'org_b', 'bbbbbbbb-0000-4000-8000-000000000003', 'tls', 'portal.borealis.example');

insert into app.check_result (org_id, monitor_id, status, payload) values
  ('org_a', 'aaaaaaaa-0000-4000-8000-000000000006', 'ok', '{"source":"rdap"}'),
  ('org_b', 'bbbbbbbb-0000-4000-8000-000000000006', 'warning', '{"chain_valid":true}');

insert into app.alert_event (id, org_id, monitor_id, asset_id, severity, rule, dedupe_key, message) values
  ('aaaaaaaa-0000-4000-8000-000000000007', 'org_a', 'aaaaaaaa-0000-4000-8000-000000000006',
   'aaaaaaaa-0000-4000-8000-000000000003', 'warning', 'domain_expiry_30d', 'domain:acmebakery.com:30', 'Domain expires in 30 days'),
  ('bbbbbbbb-0000-4000-8000-000000000007', 'org_b', 'bbbbbbbb-0000-4000-8000-000000000006',
   'bbbbbbbb-0000-4000-8000-000000000003', 'critical', 'tls_lifetime_90', 'tls:ab12:lifetime_90', 'Certificate past 90% of its lifetime');

insert into app.notification_channel (id, org_id, kind, label) values
  ('aaaaaaaa-0000-4000-8000-000000000008', 'org_a', 'email', 'Owner inbox'),
  ('bbbbbbbb-0000-4000-8000-000000000008', 'org_b', 'slack', '#alerts');

insert into app.audit_log (org_id, actor_user_id, action) values
  ('org_a', 'user_a', 'client.created'),
  ('org_b', 'user_b', 'client.created');

-- Report links: one live link per organisation. The token hashes are sha256
-- of 'token-a' and 'token-b'.
insert into app.client_report_link (id, org_id, client_id, token_hash, expires_at) values
  ('aaaaaaaa-0000-4000-8000-00000000000a', 'org_a', 'aaaaaaaa-0000-4000-8000-000000000001',
   sha256('token-a'), now() + interval '30 days'),
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'org_b', 'bbbbbbbb-0000-4000-8000-000000000001',
   sha256('token-b'), now() + interval '30 days');
