import { storePending } from '../utils/pending-credentials';
import type { TestApp } from './http-client';

const JUNE_2024 = 1_717_200_000;
const JUNE_2025 = 1_748_736_000;

export function seedSweepRecords(ctx: TestApp, id: string, inviterId: string): void {
  const owner = ctx.user.id;
  const run = (sql: string, params: (string | number)[]) => ctx.sqlite.run(sql, params);

  run(
    "INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status) VALUES (?, ?, 'storage', 's3', 'Sweep bucket', '', ?, 'active')",
    [
      id,
      owner,
      JSON.stringify({ endpoint: 'https://s3.example.com', bucket: 'b', region: 'us-east-1' }),
    ]
  );
  for (const account of ['auth', 'auth-kept']) {
    run(
      "INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials) VALUES (?, ?, 'auth', 'github', 'Sweep sign-in', '')",
      [`${id}-${account}`, owner]
    );
  }
  for (const photoId of [id, `${id}-2`]) {
    run(
      "INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size) VALUES (?, ?, 'vehicle', ?, 'car.jpg', 'image/jpeg', 4)",
      [photoId, owner, id]
    );
  }
  run("INSERT INTO vehicle_drivers (id, vehicle_id, name, created_by) VALUES (?, ?, 'Sweep', ?)", [
    id,
    id,
    owner,
  ]);
  run(
    "INSERT INTO driver_backfills (id, vehicle_id, mode, entries, created_by) VALUES (?, ?, 'logged', '[]', ?)",
    [id, id, owner]
  );
  run(
    "INSERT INTO vehicle_financing (id, vehicle_id, financing_type, provider, original_amount, term_months, start_date, payment_amount, payment_frequency) VALUES (?, ?, 'loan', 'Sweep Bank', 1000, 12, ?, 100, 'monthly')",
    [id, id, JUNE_2024]
  );
  run(
    "INSERT INTO expenses (id, vehicle_id, category, date, expense_amount, user_id, created_by) VALUES (?, ?, 'maintenance', ?, 40, ?, ?)",
    [id, id, JUNE_2024, owner, owner]
  );
  for (const part of ['a', 'b']) {
    run(
      "INSERT INTO expenses (id, vehicle_id, category, date, expense_amount, user_id, created_by, group_id, group_total, split_method) VALUES (?, ?, 'maintenance', ?, 15, ?, ?, ?, 30, 'even')",
      [`${id}-split-${part}`, id, JUNE_2024, owner, owner, id]
    );
  }
  run("INSERT INTO insurance_policies (id, user_id, company) VALUES (?, ?, 'Sweep Mutual')", [
    id,
    owner,
  ]);
  run('INSERT INTO insurance_terms (id, policy_id, start_date, end_date) VALUES (?, ?, ?, ?)', [
    id,
    id,
    JUNE_2024,
    JUNE_2025,
  ]);
  run('INSERT INTO insurance_term_vehicles (term_id, vehicle_id) VALUES (?, ?)', [id, id]);
  run(
    "INSERT INTO insurance_claims (id, policy_id, term_id, vehicle_id, claim_date, claim_type) VALUES (?, ?, ?, ?, ?, 'collision')",
    [id, id, id, id, JUNE_2024]
  );
  run(
    'INSERT INTO odometer_entries (id, vehicle_id, user_id, odometer, recorded_at, created_by) VALUES (?, ?, ?, 1000, ?, ?)',
    [id, id, owner, JUNE_2024, owner]
  );
  run(
    "INSERT INTO reminders (id, user_id, name, type, frequency, start_date, created_by) VALUES (?, ?, 'Sweep', 'notification', 'monthly', ?, ?)",
    [id, owner, JUNE_2024, owner]
  );
  run('INSERT INTO reminder_vehicles (reminder_id, vehicle_id) VALUES (?, ?)', [id, id]);
  run(
    'INSERT INTO reminder_notifications (id, reminder_id, user_id, due_date) VALUES (?, ?, ?, ?)',
    [id, id, owner, JUNE_2024]
  );
  run(
    "INSERT INTO trips (id, vehicle_id, user_id, start_odometer, end_odometer, purpose, trip_date, created_by) VALUES (?, ?, ?, 1000, 1100, 'business', ?, ?)",
    [id, id, owner, JUNE_2024, owner]
  );
  run(
    "INSERT INTO vehicle_shares (id, vehicle_id, owner_id, level, status, invited_email) VALUES (?, ?, ?, 'viewer', 'pending', 'sweep-invite@x.test')",
    [id, id, owner]
  );
  for (const invite of ['accept', 'decline']) {
    run(
      "INSERT INTO vehicles (id, user_id, make, model, year) VALUES (?, ?, 'Honda', 'Fit', 2019)",
      [`${id}-${invite}`, inviterId]
    );
    run(
      "INSERT INTO vehicle_shares (id, vehicle_id, owner_id, shared_with_id, level, status, invited_email) VALUES (?, ?, ?, ?, 'viewer', 'pending', 'sweep-owner@x.test')",
      [`${id}-${invite}`, `${id}-${invite}`, inviterId, owner]
    );
  }
  run(
    "INSERT INTO roles (id, scope, name, built_in, owner_user_id) VALUES (?, 'vehicle', 'Sweep', 0, ?)",
    [id, owner]
  );
  storePending(owner, id, 'sweep-refresh-token', 'sweep@x.test', 'google-photos');
}
