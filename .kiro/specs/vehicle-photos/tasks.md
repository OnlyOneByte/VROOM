# Implementation Plan: Vehicle Photos

## Overview

Implement a polymorphic photo system for vehicles using Google Drive storage and SQLite tracking. The backend provides a generic `PhotoRepository` with vehicle-scoped routes, and the frontend adds a photo gallery tab, upload dialog, and cover photo display. Property-based tests validate the single-cover invariant, entity isolation, and file validation rules.

## Tasks

- [x] 1. Database schema and photo repository
  - [x] 1.1 Add `photos` table schema to Drizzle
    - Create `backend/src/db/schema/photos.ts` with the `photos` table definition (polymorphic `entityType`/`entityId`, `driveFileId`, `fileName`, `mimeType`, `fileSize`, `webViewLink`, `isCover`, `sortOrder`, `createdAt`)
    - Add composite index on (`entity_type`, `entity_id`)
    - Export `Photo`, `NewPhoto`, and `PhotoEntityType` types
    - Register the table in the schema barrel export
    - Generate and apply the Drizzle migration
    - _Requirements: 6.3, 14.3_

  - [x] 1.2 Implement generic `PhotoRepository`
    - Create `backend/src/api/photos/photo-repository.ts`
    - Implement `findByEntity(entityType, entityId)` — ordered by `sortOrder` then `createdAt`
    - Implement `findById(photoId)`
    - Implement `findCoverPhoto(entityType, entityId)`
    - Implement `create(data: NewPhoto)`
    - Implement `setCoverPhoto(entityType, entityId, photoId)` — transactional unset-all then set-one
    - Implement `delete(photoId)`
    - Implement `deleteByEntity(entityType, entityId)`
    - All queries scoped by both `entityType` and `entityId`
    - _Requirements: 6.1, 6.2, 3.1, 3.4, 14.1, 14.2_

  - [x] 1.3 Write property tests for `PhotoRepository`
    - **Property 1: Single Cover Invariant** — after any sequence of create/setCover/delete operations on an entity, at most one photo has `isCover = true`
    - **Validates: Requirements 3.1, 3.4, 14.2**

  - [x] 1.4 Write property test for entity isolation
    - **Property 4: Entity Isolation** — for any two distinct (`entityType`, `entityId`) pairs, `findByEntity` results never overlap and operations on one entity never affect the other
    - **Validates: Requirements 6.1, 6.2**

- [x] 2. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Vehicle photo API routes
  - [x] 3.1 Implement entity ownership validation and Drive folder resolution helpers
    - Create `backend/src/api/photos/helpers.ts`
    - Implement `validateEntityOwnership(entityType, entityId, userId)` — switch on entity type, verify ownership via existing repositories
    - Implement `resolveEntityDriveFolder(driveService, entityType, entityId)` — create per-vehicle subfolder under "Vehicle Photos / {year} {make} {model}/"
    - _Requirements: 7.2, 7.3, 13.1, 13.2_

  - [x] 3.2 Implement shared `PhotoService` with all entity-agnostic operations
    - Create `backend/src/api/photos/photo-service.ts`
    - Implement `uploadPhotoForEntity(entityType, entityId, userId, userName, file)` — validate ownership, validate MIME type (400) and file size (413), upload to Drive, create DB record, auto-set cover if first photo
    - Implement `listPhotosForEntity(entityType, entityId, userId)` — validate ownership, return photos ordered by `sortOrder` then `createdAt`
    - Implement `getPhotoThumbnailForEntity(entityType, entityId, photoId, userId)` — validate ownership, download from Drive, return buffer and mimeType
    - Implement `setCoverPhotoForEntity(entityType, entityId, photoId, userId)` — validate ownership, verify photo belongs to entity, call `setCoverPhoto`
    - Implement `deletePhotoForEntity(entityType, entityId, photoId, userId)` — validate ownership, delete from Drive (best-effort), delete DB record, promote next cover if needed
    - Implement `deleteAllPhotosForEntity(entityType, entityId, userId)` — delete all Drive files (best-effort), then `deleteByEntity`
    - Export shared constants `ALLOWED_MIME_TYPES` and `MAX_FILE_SIZE`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 9.1, 9.2_

  - [x] 3.3 Implement thin vehicle photo routes using `PhotoService`
    - Rewrite `backend/src/api/vehicles/photo-routes.ts` as a thin Hono sub-router
    - Implement `POST /` — extract vehicleId, delegate to `uploadPhotoForEntity('vehicle', ...)`
    - Implement `GET /` — delegate to `listPhotosForEntity('vehicle', ...)`
    - Implement `GET /:photoId/thumbnail` — delegate to `getPhotoThumbnailForEntity(...)`, return with `Content-Type` and `Cache-Control: private, max-age=3600`
    - Implement `PUT /:photoId/cover` — delegate to `setCoverPhotoForEntity('vehicle', ...)`
    - Implement `DELETE /:photoId` — delegate to `deletePhotoForEntity('vehicle', ...)`, return 204
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 7.1_

  - [x] 3.4 Mount photo routes and add cascade delete hook
    - Mount `photoRoutes` on `/:vehicleId/photos` in `backend/src/api/vehicles/routes.ts`
    - Add `requireAuth` middleware to the sub-router
    - Hook into vehicle deletion to call `deleteAllPhotosForEntity('vehicle', vehicleId, userId)` with best-effort Drive cleanup
    - _Requirements: 7.1, 8.1, 8.2, 8.3_

  - [x] 3.5 Write property tests for upload validation
    - **Property 6: MIME Type Validation** — any file with MIME type not in `{image/jpeg, image/png, image/webp}` is rejected with 400 and no record created
    - **Validates: Requirements 1.4, 9.1**
    - **Property 7: File Size Validation** — any file exceeding 10,485,760 bytes is rejected with 413 and no record created
    - **Validates: Requirements 1.5, 9.2**

  - [x] 3.6 Write property test for auto-cover behavior
    - **Property 2: Auto-Cover on First Upload** — first photo for an entity gets `isCover = true`; subsequent uploads leave existing cover unchanged
    - **Validates: Requirements 1.2, 1.3**
    - **Property 3: Cover Promotion on Delete** — when cover photo is deleted and others remain, oldest remaining becomes cover
    - **Validates: Requirements 4.2, 3.4**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Frontend photo types and API service
  - [x] 5.1 Add `Photo` type and vehicle API extensions
    - Add `Photo` interface to `frontend/src/lib/types/index.ts`
    - Extend `vehicleApi` in `frontend/src/lib/services/vehicle-api.ts` with `getPhotos`, `uploadPhoto`, `setCoverPhoto`, `deletePhoto`, and `getPhotoThumbnailUrl` methods
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1_

- [x] 6. Frontend photo components
  - [x] 6.1 Implement `VehiclePhotoGallery` component
    - Create `frontend/src/lib/components/vehicles/VehiclePhotoGallery.svelte`
    - Display photo grid with thumbnails using `loading="lazy"`
    - Show cover badge on the cover photo
    - Provide "Set as cover" and "Delete" actions per photo
    - Show empty state with upload guidance when no photos exist
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 6.2 Implement `PhotoUploadDialog` component
    - Create `frontend/src/lib/components/vehicles/PhotoUploadDialog.svelte`
    - File picker and drag-and-drop support
    - Client-side validation of file type and size before upload
    - Upload progress indication
    - Error display on failure
    - Sequential upload for multiple files
    - _Requirements: 9.3, 12.1, 12.2, 12.3, 12.4_

  - [x] 6.3 Add Photos tab to vehicle detail page
    - Add a "Photos" tab to the vehicle detail page route
    - Load photos via `vehicleApi.getPhotos` and pass to `VehiclePhotoGallery`
    - Wire upload, delete, and set-cover handlers to update local state
    - _Requirements: 10.1, 10.5_

  - [x] 6.4 Visual verification: Photos tab and gallery
    - Using Chrome DevTools MCP, navigate to a vehicle detail page and verify:
      - The "Photos" tab is visible and clickable
      - The photo gallery renders correctly (empty state with upload guidance when no photos)
      - The upload dialog opens and displays file picker / drag-and-drop area
      - Gallery grid layout looks correct on desktop viewport
      - Take a screenshot for verification
    - _Requirements: 10.1, 10.3, 12.1_

  - [x] 6.5 Display cover photo in `VehicleHeader` and dashboard cards
    - Update `VehicleHeader.svelte` to show cover photo thumbnail via the proxy endpoint
    - Show placeholder when no cover photo exists
    - Update dashboard vehicle cards to show cover photo if available
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 6.6 Visual verification: Cover photo display
    - Using Chrome DevTools MCP, verify:
      - Vehicle header shows placeholder when no cover photo exists
      - Dashboard vehicle cards render correctly with and without cover photos
      - Take screenshots of both the vehicle header and dashboard cards
    - _Requirements: 11.1, 11.2_

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. End-to-end visual verification of all major flows
  - Using Chrome DevTools MCP, run through the complete photo workflow:
    - Navigate to a vehicle detail page and open the Photos tab
    - Verify the empty state is displayed correctly
    - Open the upload dialog and verify it renders with file picker and drag-and-drop area
    - Upload a photo and verify it appears in the gallery with a cover badge (auto-cover on first upload)
    - Upload a second photo and verify it appears without a cover badge
    - Click "Set as cover" on the second photo and verify the cover badge moves
    - Delete the first photo and verify it is removed from the gallery
    - Navigate to the dashboard and verify the cover photo appears on the vehicle card
    - Navigate back to the vehicle detail page and verify the cover photo shows in the vehicle header
    - Take screenshots at each major step for verification
  - _Requirements: 1.2, 3.1, 4.1, 10.1, 10.2, 10.5, 11.1, 12.1_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirement acceptance criteria for traceability
- Property tests use `fast-check` and validate correctness properties from the design document
- The `PhotoRepository` is entity-agnostic; vehicle routes hardcode `entityType: 'vehicle'`
- Google Drive deletions are best-effort — orphaned files are acceptable
