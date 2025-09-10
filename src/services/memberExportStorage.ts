import { promises as fs } from 'fs';
import path from 'path';

export interface GroupMemberRecord {
  userId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
}

export interface SaveGroupMembersParams {
  adminUserId: string;
  groupId: string;
  groupName: string;
  members: GroupMemberRecord[];
}

export interface MemberExportStorageResult {
  location: string;
}

export interface MemberExportStorage {
  saveGroupMembers(params: SaveGroupMembersParams): Promise<MemberExportStorageResult>;
}

class FileMemberExportStorage implements MemberExportStorage {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || path.join(process.cwd(), 'exports');
  }

  async saveGroupMembers(params: SaveGroupMembersParams): Promise<MemberExportStorageResult> {
    const safeGroup = params.groupName.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(this.baseDir, 'group-members');
    await fs.mkdir(dir, { recursive: true });

    const filePath = path.join(dir, `${safeGroup}_${timestamp}.csv`);

    const header = 'userId,username,name\n';
    const lines = params.members.map(m => {
      const name = [m.firstName || '', m.lastName || ''].filter(Boolean).join(' ').trim();
      const username = m.username ? `@${m.username}` : '';
      // Escape CSV fields with quotes if needed
      const esc = (v: string) => {
        if (v.includes(',') || v.includes('"') || v.includes('\n')) {
          return '"' + v.replace(/"/g, '""') + '"';
        }
        return v;
      };
      return [m.userId, username, name].map(v => esc(v)).join(',');
    });

    await fs.writeFile(filePath, header + lines.join('\n'), 'utf-8');
    return { location: filePath };
  }
}

let currentStorage: MemberExportStorage = new FileMemberExportStorage();

export function setMemberExportStorage(storage: MemberExportStorage): void {
  currentStorage = storage;
}

export async function exportGroupMembers(params: SaveGroupMembersParams): Promise<MemberExportStorageResult> {
  return currentStorage.saveGroupMembers(params);
}


