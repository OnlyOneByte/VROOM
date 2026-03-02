# Requirements Document

## Introduction

Vehicle Photos enables users to attach, manage, and display photos for their vehicles. Photos are stored in Google Drive and tracked in a local SQLite database using a polymorphic association pattern (`entityType` + `entityId`). Users can upload JPEG/PNG/WebP images (up to 10MB), designate a cover photo per vehicle, and view photos in a gallery on the vehicle detail page. The system enforces ownership, file validation, and a single-cover invariant per entity.

## Glossary

- **Photo_API**: The backend HTTP route handlers mounted at `/api/v1/vehicles/:vehicleId/photos` that handle photo CRUD operations
- **PhotoRepository**: The generic data access layer for the `photos` table, scoped by `entityType` and `entityId`
- **Photo_Gallery**: The frontend `VehiclePhotoGallery` component that displays photos in a grid on the vehicle detail page
- **Upload_Dialog**: The frontend `PhotoUploadDialog` component for selecting and uploading photo files
- **Cover_Photo**: The single photo per entity marked with `isCover = true`, displayed in the vehicle header and dashboard cards
- **Drive_Service**: The existing `GoogleDriveService` used for uploading, downloading, and deleting files in Google Drive
- **Entity**: A polymorphic reference consisting of an `entityType` (e.g., `'vehicle'`) and `entityId` pair
- **Thumbnail_Proxy**: The backend endpoint that downloads a photo from Google Drive and serves it to the frontend with access control

## Requirements

### Requirement 1: Photo Upload

**User Story:** As a vehicle owner, I want to upload photos to my vehicle, so that I can visually document my vehicle's condition and appearance.

#### Acceptance Criteria

1. WHEN a user submits a valid image file via the upload endpoint, THE Photo_API SHALL upload the file to Google Drive under a per-vehicle subfolder and create a corresponding record in the photos table with `entityType` set to `'vehicle'` and `entityId` set to the vehicle ID
2. WHEN the uploaded photo is the first photo for that vehicle, THE Photo_API SHALL automatically set `isCover` to `true` on the created photo record
3. WHEN the uploaded photo is not the first photo for that vehicle, THE Photo_API SHALL set `isCover` to `false` on the created photo record
4. WHEN a user attempts to upload a file with a MIME type other than `image/jpeg`, `image/png`, or `image/webp`, THE Photo_API SHALL reject the request with a 400 status and the message "Only JPEG, PNG, and WebP images are allowed"
5. WHEN a user attempts to upload a file exceeding 10,485,760 bytes (10MB), THE Photo_API SHALL reject the request with a 413 status and the message "Photo must be under 10MB"
6. WHEN a user attempts to upload a photo to a vehicle they do not own, THE Photo_API SHALL reject the request with a 404 status

### Requirement 2: Photo Listing

**User Story:** As a vehicle owner, I want to view all photos for my vehicle, so that I can browse my vehicle's photo collection.

#### Acceptance Criteria

1. WHEN a user requests the photo list for a vehicle they own, THE Photo_API SHALL return all photo records where `entityType` is `'vehicle'` and `entityId` matches the vehicle ID, ordered by `sortOrder` then `createdAt`
2. WHEN a user requests the photo list for a vehicle they do not own, THE Photo_API SHALL reject the request with a 404 status
3. WHEN a vehicle has no photos, THE Photo_API SHALL return an empty array

### Requirement 3: Cover Photo Management

**User Story:** As a vehicle owner, I want to designate one photo as the cover photo, so that it represents my vehicle in headers and dashboard cards.

#### Acceptance Criteria

1. WHEN a user sets a photo as cover for a vehicle, THE PhotoRepository SHALL unset `isCover` on all other photos for that entity and set `isCover` to `true` on the target photo within a single transaction
2. WHEN a user sets a photo as cover, THE Photo_API SHALL verify the photo belongs to the specified vehicle before updating
3. IF a user attempts to set a non-existent photo as cover, THEN THE Photo_API SHALL return a 404 status
4. WHILE a vehicle has at least one photo, THE PhotoRepository SHALL ensure exactly one photo has `isCover` set to `true` for that vehicle


### Requirement 4: Photo Deletion

**User Story:** As a vehicle owner, I want to delete photos from my vehicle, so that I can remove outdated or unwanted images.

#### Acceptance Criteria

1. WHEN a user deletes a photo, THE Photo_API SHALL remove the file from Google Drive and delete the corresponding record from the photos table
2. WHEN the deleted photo had `isCover` set to `true` and other photos remain for that vehicle, THE PhotoRepository SHALL promote the oldest remaining photo to cover by setting its `isCover` to `true`
3. WHEN the deleted photo had `isCover` set to `true` and no other photos remain for that vehicle, THE PhotoRepository SHALL leave no cover photo for that vehicle
4. IF the Google Drive deletion fails, THEN THE Photo_API SHALL still delete the database record and log a warning
5. IF a user attempts to delete a photo that does not belong to the specified vehicle, THEN THE Photo_API SHALL return a 404 status

### Requirement 5: Thumbnail Proxy

**User Story:** As a vehicle owner, I want to view photo thumbnails through the application, so that I can see my photos without exposing direct Google Drive URLs.

#### Acceptance Criteria

1. WHEN a user requests a photo thumbnail for a vehicle they own, THE Photo_API SHALL download the image from Google Drive via the Drive_Service and return it with the correct `Content-Type` header
2. WHEN a user requests a photo thumbnail, THE Photo_API SHALL set `Cache-Control: private, max-age=3600` on the response
3. IF a user requests a thumbnail for a photo that does not belong to the specified vehicle, THEN THE Photo_API SHALL return a 404 status

### Requirement 6: Entity Scoping and Polymorphic Isolation

**User Story:** As a developer, I want photos to be strictly scoped by entity type and entity ID, so that the photo system is reusable across different entity types without data leakage.

#### Acceptance Criteria

1. THE PhotoRepository SHALL scope all query operations by both `entityType` and `entityId`
2. WHEN querying photos for entity (`entityType` A, `entityId` X), THE PhotoRepository SHALL return zero photos that have a different `entityType`, even if the `entityId` matches
3. THE photos table SHALL have a composite index on (`entity_type`, `entity_id`) for efficient scoped queries

### Requirement 7: Ownership and Authorization

**User Story:** As a vehicle owner, I want all photo operations to be protected by authentication and ownership checks, so that no other user can access or modify my photos.

#### Acceptance Criteria

1. THE Photo_API SHALL require authentication via the existing `requireAuth` middleware on all photo endpoints
2. WHEN any photo operation is requested, THE Photo_API SHALL verify that the authenticated user owns the parent entity before proceeding
3. IF the parent entity does not exist or does not belong to the authenticated user, THEN THE Photo_API SHALL return a 404 status without revealing whether the entity exists

### Requirement 8: Application-Level Cascade Delete

**User Story:** As a developer, I want vehicle deletion to clean up all associated photos, so that no orphaned photo records remain in the database after a vehicle is removed.

#### Acceptance Criteria

1. WHEN a vehicle is deleted, THE Photo_API SHALL delete all Google Drive files for that vehicle's photos (best-effort) and then remove all photo records via `PhotoRepository.deleteByEntity('vehicle', vehicleId)`
2. IF a Google Drive file deletion fails during cascade, THEN THE Photo_API SHALL log a warning and continue deleting the remaining photos
3. WHEN cascade deletion completes, THE photos table SHALL contain zero records where `entityType` is `'vehicle'` and `entityId` matches the deleted vehicle ID

### Requirement 9: File Validation

**User Story:** As a vehicle owner, I want the system to validate my uploads, so that only valid image files are stored.

#### Acceptance Criteria

1. THE Photo_API SHALL validate the MIME type server-side, accepting only `image/jpeg`, `image/png`, and `image/webp`
2. THE Photo_API SHALL validate the file size server-side, rejecting files exceeding 10,485,760 bytes
3. THE Upload_Dialog SHALL validate file type and file size client-side before initiating the upload, providing immediate feedback to the user

### Requirement 10: Photo Gallery Display

**User Story:** As a vehicle owner, I want to see my vehicle's photos in a gallery view, so that I can browse, manage, and interact with them easily.

#### Acceptance Criteria

1. WHEN a user navigates to the vehicle detail page, THE Photo_Gallery SHALL display all photos for that vehicle in a grid of thumbnails
2. WHEN a photo has `isCover` set to `true`, THE Photo_Gallery SHALL display a visible cover badge on that photo's thumbnail
3. WHEN a vehicle has no photos, THE Photo_Gallery SHALL display an empty state with guidance on how to upload photos
4. THE Photo_Gallery SHALL use `loading="lazy"` on thumbnail images to defer loading of off-screen images
5. WHEN a user clicks "Set as cover" on a photo, THE Photo_Gallery SHALL call the set-cover endpoint and update the cover badge in the gallery and vehicle header

### Requirement 11: Cover Photo Display

**User Story:** As a vehicle owner, I want my cover photo to appear in the vehicle header and dashboard cards, so that my vehicle is visually identifiable at a glance.

#### Acceptance Criteria

1. WHEN a vehicle has a cover photo, THE VehicleHeader SHALL display the cover photo thumbnail via the Thumbnail_Proxy endpoint
2. WHEN a vehicle has no cover photo, THE VehicleHeader SHALL display a default placeholder or no image
3. WHEN the cover photo changes, THE VehicleHeader SHALL update to reflect the new cover photo

### Requirement 12: Photo Upload Dialog

**User Story:** As a vehicle owner, I want a dedicated upload dialog with drag-and-drop support, so that I can conveniently add photos to my vehicle.

#### Acceptance Criteria

1. WHEN the upload dialog is opened, THE Upload_Dialog SHALL accept file selection via file picker and drag-and-drop
2. WHILE a photo upload is in progress, THE Upload_Dialog SHALL display upload progress indication
3. IF an upload fails, THEN THE Upload_Dialog SHALL display an error message describing the failure
4. WHEN multiple files are selected, THE Upload_Dialog SHALL upload them sequentially to avoid overwhelming the Google Drive API

### Requirement 13: Google Drive Folder Organization

**User Story:** As a vehicle owner, I want my photos organized in per-vehicle subfolders in Google Drive, so that my Drive storage remains tidy.

#### Acceptance Criteria

1. WHEN a photo is uploaded for a vehicle, THE Drive_Service SHALL store the file under `Vehicle Photos / {year} {make} {model} /` within the VROOM folder structure
2. IF the per-vehicle subfolder does not exist, THEN THE Drive_Service SHALL create it before uploading the file

### Requirement 14: Data Integrity

**User Story:** As a developer, I want photo records to be immutable in their entity binding and consistent in their cover state, so that the data model remains reliable.

#### Acceptance Criteria

1. THE PhotoRepository SHALL treat `entityType` and `entityId` as immutable after photo creation — no update operations shall modify these fields
2. THE PhotoRepository SHALL enforce that at most one photo per entity has `isCover` set to `true` after any write operation
3. THE photos table SHALL store `fileSize` as a positive integer and `mimeType` as one of the three allowed values for every record
