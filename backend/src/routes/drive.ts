import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireAuth } from '../lib/middleware/auth';
import { GoogleDriveService, createDriveServiceForUser } from '../lib/google-drive';
import { z } from 'zod';

const drive = new Hono();

// All drive routes require authentication
drive.use('*', requireAuth);

/**
 * POST /api/drive/setup
 * Create the VROOM folder structure in Google Drive
 */
drive.post('/setup', async (c) => {
  try {
    const user = c.get('user');
    
    const driveService = await createDriveServiceForUser(user.id);
    const folderStructure = await driveService.createVroomFolderStructure(user.displayName);

    return c.json({
      message: 'VROOM folder structure created successfully',
      folders: {
        main: {
          id: folderStructure.mainFolder.id,
          name: folderStructure.mainFolder.name,
          webViewLink: folderStructure.mainFolder.webViewLink,
        },
        receipts: {
          id: folderStructure.subFolders.receipts.id,
          name: folderStructure.subFolders.receipts.name,
          webViewLink: folderStructure.subFolders.receipts.webViewLink,
        },
        maintenance: {
          id: folderStructure.subFolders.maintenance.id,
          name: folderStructure.subFolders.maintenance.name,
          webViewLink: folderStructure.subFolders.maintenance.webViewLink,
        },
        photos: {
          id: folderStructure.subFolders.photos.id,
          name: folderStructure.subFolders.photos.name,
          webViewLink: folderStructure.subFolders.photos.webViewLink,
        },
      },
    });
  } catch (error) {
    console.error('Drive setup error:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('not found') || error.message.includes('access not available')) {
        throw new HTTPException(401, { 
          message: 'Google Drive access not available. Please re-authenticate with Google.' 
        });
      }
    }
    
    throw new HTTPException(500, { 
      message: 'Failed to set up Google Drive folder structure' 
    });
  }
});

/**
 * GET /api/drive/folder
 * Get information about the VROOM folder and its contents
 */
drive.get('/folder', async (c) => {
  try {
    const user = c.get('user');
    
    const driveService = await createDriveServiceForUser(user.id);
    const folderStructure = await driveService.createVroomFolderStructure(user.displayName);

    // Get contents of each folder
    const [mainContents, receiptsContents, maintenanceContents, photosContents] = await Promise.all([
      driveService.listFilesInFolder(folderStructure.mainFolder.id),
      driveService.listFilesInFolder(folderStructure.subFolders.receipts.id),
      driveService.listFilesInFolder(folderStructure.subFolders.maintenance.id),
      driveService.listFilesInFolder(folderStructure.subFolders.photos.id),
    ]);

    return c.json({
      folders: {
        main: {
          id: folderStructure.mainFolder.id,
          name: folderStructure.mainFolder.name,
          webViewLink: folderStructure.mainFolder.webViewLink,
          contents: mainContents,
        },
        receipts: {
          id: folderStructure.subFolders.receipts.id,
          name: folderStructure.subFolders.receipts.name,
          webViewLink: folderStructure.subFolders.receipts.webViewLink,
          contents: receiptsContents,
        },
        maintenance: {
          id: folderStructure.subFolders.maintenance.id,
          name: folderStructure.subFolders.maintenance.name,
          webViewLink: folderStructure.subFolders.maintenance.webViewLink,
          contents: maintenanceContents,
        },
        photos: {
          id: folderStructure.subFolders.photos.id,
          name: folderStructure.subFolders.photos.name,
          webViewLink: folderStructure.subFolders.photos.webViewLink,
          contents: photosContents,
        },
      },
    });
  } catch (error) {
    console.error('Get drive folder error:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('not found') || error.message.includes('access not available')) {
        throw new HTTPException(401, { 
          message: 'Google Drive access not available. Please re-authenticate with Google.' 
        });
      }
    }
    
    throw new HTTPException(500, { 
      message: 'Failed to get Google Drive folder information' 
    });
  }
});

/**
 * POST /api/drive/folder/receipts/organize
 * Create date-organized folders in receipts folder
 */
const organizeFoldersSchema = z.object({
  year: z.number().min(2020).max(2030),
  month: z.number().min(1).max(12),
});

drive.post('/folder/receipts/organize', async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();
    const { year, month } = organizeFoldersSchema.parse(body);
    
    const driveService = await createDriveServiceForUser(user.id);
    const folderStructure = await driveService.createVroomFolderStructure(user.displayName);
    
    const dateFolder = await driveService.createReceiptDateFolders(
      folderStructure.subFolders.receipts.id,
      year,
      month
    );

    return c.json({
      message: 'Date-organized folder created successfully',
      folder: {
        id: dateFolder.id,
        name: dateFolder.name,
        webViewLink: dateFolder.webViewLink,
      },
    });
  } catch (error) {
    console.error('Organize receipts folder error:', error);
    
    if (error instanceof z.ZodError) {
      throw new HTTPException(400, { 
        message: `Invalid request data: ${error.issues.map(i => i.message).join(', ')}`,
      });
    }
    
    if (error instanceof Error) {
      if (error.message.includes('not found') || error.message.includes('access not available')) {
        throw new HTTPException(401, { 
          message: 'Google Drive access not available. Please re-authenticate with Google.' 
        });
      }
    }
    
    throw new HTTPException(500, { 
      message: 'Failed to organize receipts folder' 
    });
  }
});

/**
 * GET /api/drive/folder/:folderId/contents
 * Get contents of a specific folder
 */
drive.get('/folder/:folderId/contents', async (c) => {
  try {
    const user = c.get('user');
    const folderId = c.req.param('folderId');
    
    if (!folderId) {
      throw new HTTPException(400, { message: 'Folder ID is required' });
    }
    
    const driveService = await createDriveServiceForUser(user.id);
    const contents = await driveService.listFilesInFolder(folderId);

    return c.json({
      folderId,
      contents,
    });
  } catch (error) {
    console.error('Get folder contents error:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('not found') || error.message.includes('access not available')) {
        throw new HTTPException(401, { 
          message: 'Google Drive access not available. Please re-authenticate with Google.' 
        });
      }
    }
    
    throw new HTTPException(500, { 
      message: 'Failed to get folder contents' 
    });
  }
});

/**
 * GET /api/drive/folder/:folderId/permissions
 * Get permissions for a specific folder
 */
drive.get('/folder/:folderId/permissions', async (c) => {
  try {
    const user = c.get('user');
    const folderId = c.req.param('folderId');
    
    if (!folderId) {
      throw new HTTPException(400, { message: 'Folder ID is required' });
    }
    
    const driveService = await createDriveServiceForUser(user.id);
    const permissions = await driveService.getFolderPermissions(folderId);

    return c.json({
      folderId,
      permissions,
    });
  } catch (error) {
    console.error('Get folder permissions error:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('not found') || error.message.includes('access not available')) {
        throw new HTTPException(401, { 
          message: 'Google Drive access not available. Please re-authenticate with Google.' 
        });
      }
    }
    
    throw new HTTPException(500, { 
      message: 'Failed to get folder permissions' 
    });
  }
});

/**
 * POST /api/drive/folder/:folderId/share
 * Share a folder with another user
 */
const shareFolderSchema = z.object({
  email: z.string().email(),
  role: z.enum(['reader', 'writer']).default('reader'),
});

drive.post('/folder/:folderId/share', async (c) => {
  try {
    const user = c.get('user');
    const folderId = c.req.param('folderId');
    const body = await c.req.json();
    const { email, role } = shareFolderSchema.parse(body);
    
    if (!folderId) {
      throw new HTTPException(400, { message: 'Folder ID is required' });
    }
    
    const driveService = await createDriveServiceForUser(user.id);
    await driveService.setFolderPermissions(folderId, email, role);

    return c.json({
      message: 'Folder shared successfully',
      folderId,
      sharedWith: email,
      role,
    });
  } catch (error) {
    console.error('Share folder error:', error);
    
    if (error instanceof z.ZodError) {
      throw new HTTPException(400, { 
        message: `Invalid request data: ${error.issues.map(i => i.message).join(', ')}`,
      });
    }
    
    if (error instanceof Error) {
      if (error.message.includes('not found') || error.message.includes('access not available')) {
        throw new HTTPException(401, { 
          message: 'Google Drive access not available. Please re-authenticate with Google.' 
        });
      }
    }
    
    throw new HTTPException(500, { 
      message: 'Failed to share folder' 
    });
  }
});

export { drive };