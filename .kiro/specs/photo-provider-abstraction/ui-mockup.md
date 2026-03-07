# Photo Storage Settings — UI Mockup

## Main Settings Page

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚙️  Photo Storage Settings                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  📷 DEFAULT PHOTO SOURCES                                   ││
│  │  Where photos are served from in the app.                   ││
│  │  You must configure these to see photos in the app.         ││
│  │                                                             ││
│  │  Vehicle Photos      [ Google Drive ▾ ]                     ││
│  │  Expense Receipts    [ Google Drive ▾ ]                     ││
│  │  Insurance Docs      [ Backblaze B2  ▾ ]                    ││
│  │                                                             ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  🗄️ IMAGE PROVIDERS                                         ││
│  │                                                             ││
│  │  [ + Add Image Provider ]                                   ││
│  │                                                             ││
│  │  ┌─────────────────────────────────────────────────────────┐││
│  │  │  ☁️ Google Drive — "My Google Drive"          [Edit][🗑️]│││
│  │  │  Status: ✅ Connected                                   │││
│  │  │  Last sync: 2 hours ago                                 │││
│  │  │                                                         │││
│  │  │  ── Provider Settings ──────────────────────────────    │││
│  │  │  (Google-specific: OAuth account, etc.)                 │││
│  │  │  Account: user@gmail.com                                │││
│  │  │                                                         │││
│  │  │  ── Folder Settings ────────────────────────────────    │││
│  │  │  Root Path   [ /VROOM                          ]        │││
│  │  │                                                         │││
│  │  │  ☑ Enable All / ☐ Disable All                           │││
│  │  │                                                         │││
│  │  │  [✅] Vehicle Photos    [ /Vehicle Photos      ]        │││
│  │  │  [✅] Expense Receipts  [ /Receipts            ]        │││
│  │  │  [✅] Insurance Docs    [ /Insurance           ]        │││
│  │  └─────────────────────────────────────────────────────────┘││
│  │                                                             ││
│  │  ┌─────────────────────────────────────────────────────────┐││
│  │  │  🪣 Backblaze B2 — "Offsite Backup"           [Edit][🗑️]│││
│  │  │  Status: ✅ Connected                                   │││
│  │  │  Last sync: 5 min ago                                   │││
│  │  │                                                         │││
│  │  │  ── Provider Settings ──────────────────────────────    │││
│  │  │  (S3-specific: endpoint, bucket, region, keys)          │││
│  │  │  Endpoint: s3.us-west-002.backblazeb2.com               │││
│  │  │  Bucket:   vroom-photos                                 │││
│  │  │  Region:   us-west-002                                  │││
│  │  │                                                         │││
│  │  │  ── Folder Settings ────────────────────────────────    │││
│  │  │  Root Path   [ /backups/vroom                  ]        │││
│  │  │                                                         │││
│  │  │  ☑ Enable All / ☐ Disable All                           │││
│  │  │                                                         │││
│  │  │  [✅] Vehicle Photos    [ /vehicles            ]        │││
│  │  │  [✅] Expense Receipts  [ /receipts            ]        │││
│  │  │  [☐ ] Insurance Docs    [ /insurance           ]        │││
│  │  └─────────────────────────────────────────────────────────┘││
│  │                                                             ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Add Image Provider Dialog

```
┌─────────────────────────────────────────────────────────────────┐
│  Add Image Provider                                      [ ✕ ] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Provider Type                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │  Google   │ │   S3 /   │ │ OneDrive │ │ Dropbox  │          │
│  │  Drive    │ │ B2 / R2  │ │          │ │          │          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
│                                                                 │
│  Display Name  [ My Backblaze Backup             ]              │
│                                                                 │
│  ── Provider-Specific Settings ───────────────────────────      │
│  (fields change based on selected type)                         │
│                                                                 │
│  │ For S3-compat:                                               │
│  │ Endpoint     [ s3.us-west-002.backblazeb2.com ]              │
│  │ Bucket       [ vroom-photos                   ]              │
│  │ Region       [ us-west-002                    ]              │
│  │ Access Key   [ ******************************** ]             │
│  │ Secret Key   [ ******************************** ]             │
│  │                                                              │
│  │ For Google Drive:                                            │
│  │ [ 🔗 Connect Google Account ]                                │
│  │                                                              │
│                                                                 │
│  ── Folder Settings (shared) ─────────────────────────────      │
│  Root Path     [ /backups/vroom                  ]              │
│                                                                 │
│  ☑ Enable All / ☐ Disable All                                   │
│                                                                 │
│  [✅] Vehicle Photos    [ /vehicles              ]              │
│  [✅] Expense Receipts  [ /receipts              ]              │
│  [✅] Insurance Docs    [ /insurance             ]              │
│                                                                 │
│  [ Test Connection ]                    [ Cancel ] [ Save ]     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Design Notes

- The "Default Photo Sources" dropdowns only list providers that have the
  corresponding category enabled. If no provider has "Insurance Docs" enabled,
  that dropdown shows "Not configured".
- Folder Settings are shared UI but optional per provider type. File/folder-based
  providers (Google Drive, S3, OneDrive, NAS) show the full folder settings.
  Photo-API-based providers (Google Photos) skip the folder section entirely
  since they don't use file paths.
- The per-category folder path is relative to the root path. Example:
  Root `/VROOM` + Vehicle Photos `/Vehicle Photos` = `/VROOM/Vehicle Photos/`
- The enable/disable toggle per category controls whether that provider backs up
  that photo type. A provider can be connected but only handle certain categories.
- "Enable All / Disable All" is a convenience toggle at the top of the category list.
