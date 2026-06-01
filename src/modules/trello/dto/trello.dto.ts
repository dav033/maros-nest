export interface TrelloMember {
  id: string;
  fullName: string;
  username: string;
}

export interface TrelloBoard {
  id: string;
  name: string;
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
}

export interface CreateTrelloCardInput {
  idList: string;
  name: string;
  desc?: string;
  due?: string;
  idMembers?: string[];
  pos?: 'top' | 'bottom';
}

export interface UpdateTrelloCardInput {
  name?: string;
  desc?: string;
  due?: string | null;
  idList?: string;
  closed?: boolean;
  idMembers?: string[];
}
