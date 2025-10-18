import { eq } from 'drizzle-orm';
import { users } from '../../db/schema';
import { databaseService } from '../database';
import { GoogleDriveService } from '../google-drive';

export async function getDriveServiceForUser(userId: string): Promise<GoogleDriveService> {
  const db = databaseService.getDatabase();
  const userInfo = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (!userInfo.length || !userInfo[0].googleRefreshToken) {
    const error = new Error(
      'Google Drive access not available. Please re-authenticate with Google.'
    );
    (error as Error & { code: string }).code = 'AUTH_INVALID';
    throw error;
  }

  // Use refresh token for both parameters (access token is refreshed automatically)
  return new GoogleDriveService(userInfo[0].googleRefreshToken, userInfo[0].googleRefreshToken);
}
