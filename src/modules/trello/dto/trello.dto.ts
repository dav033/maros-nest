export interface TrelloMember {
  id: string;
  fullName: string;
  username: string;
}

export interface TrelloBoard {
  id: string;
  name: string;
  desc: string;
  closed: boolean;
  url: string;
}

export interface TrelloList {
  id: string;
  name: string;
  idBoard: string;
  closed: boolean;
}

export interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  idList: string;
  idBoard: string;
  due: string | null;
  idMembers: string[];
  url: string;
  shortUrl: string;
  attachments?: TrelloAttachment[];
}

export interface TrelloAttachment {
  id: string;
  name: string;
  url: string;
  bytes?: number;
  mimeType?: string;
  isUpload?: boolean;
  date?: string;
}

export interface CreateTrelloCardAttachmentInput {
  url: string;
  name?: string;
  setCover?: boolean;
}

export interface CreateTrelloCardInput {
  idList: string;
  name: string;
  desc?: string;
  due?: string;
  idMembers?: string[];
  pos?: 'top' | 'bottom';
  attachments?: CreateTrelloCardAttachmentInput[];
}

export interface UpdateTrelloCardInput {
  name?: string;
  desc?: string;
  due?: string | null;
  idList?: string;
  closed?: boolean;
  idMembers?: string[];
}

export interface CreateTrelloBoardInput {
  name: string;
  desc?: string;
  defaultLists?: boolean;
  defaultLabels?: boolean;
  idOrganization?: string;
  prefsPermissionLevel?: 'private' | 'org' | 'public';
}

export interface UpdateTrelloBoardInput {
  name?: string;
  desc?: string;
  closed?: boolean;
  subscribed?: boolean;
  prefsPermissionLevel?: 'private' | 'org' | 'public';
}

export interface CreateTrelloListInput {
  idBoard: string;
  name: string;
  pos?: 'top' | 'bottom' | number;
}

export interface UpdateTrelloListInput {
  name?: string;
  closed?: boolean;
  pos?: 'top' | 'bottom' | number;
}
