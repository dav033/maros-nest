import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Company } from '../../../../entities/company.entity';
import { Contact } from '../../../../entities/contact.entity';
import { Lead } from '../../../../entities/lead.entity';
import { NotePage } from '../../../../entities/note-page.entity';
import {
  NOTE_REFERENCE_KINDS,
  type NoteReferenceKind,
} from '../../../../entities/note-reference.entity';
import { Project } from '../../../../entities/project.entity';
import { Task } from '../../../../entities/task.entity';
import { User } from '../../../../entities/user.entity';
import {
  NoteReferenceTargetNotFoundException,
  NoteReferenceUnsupportedKindException,
} from '../../../../common/exceptions';
import { NotesRepository } from '../../note-management/repositories/notes.repository';
import type { NoteActor } from '../../note-management/services/note-access.service';

/** One referenceable record, flattened to what a chip and a picker row both need. */
export interface NoteReferenceTarget {
  kind: NoteReferenceKind;
  id: number;
  /** The record's name. Never empty — falls back to "Lead #42" so a chip is never blank. */
  label: string;
  /** Lead number, email, task status: whatever tells two same-named records apart. */
  sublabel: string | null;
  /** False when the row is gone and only the snapshot is left. */
  exists: boolean;
}

/** `kind:id`, the key every batch lookup is collected under. */
type TargetKey = string;

const key = (kind: NoteReferenceKind, id: number): TargetKey => `${kind}:${id}`;

/** Postgres ILIKE wildcards in a user's query are theirs to type, not ours to honour. */
function likeTerm(query: string): string {
  return `%${query.trim().replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

/**
 * Resolves reference targets across the CRM: what a record is called, whether it still
 * exists, and which records match a search.
 *
 * Reads the other modules' tables through TypeORM repositories rather than calling their
 * services — the same choice TaskWorkspaceLinkResolverService makes, and for the same
 * reason: a note can point at a lead, a project, a contact, a company, a task, a user or
 * another note, and injecting seven services into the notes module would make it depend
 * on nearly the whole application (and import a cycle the first time one of them wanted
 * to read notes back).
 */
@Injectable()
export class NoteReferenceTargetsService {
  constructor(
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    @InjectRepository(Company) private readonly companies: Repository<Company>,
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(NotePage) private readonly notes: Repository<NotePage>,
  ) {}

  assertSupportedKind(kind: string): NoteReferenceKind {
    if (!(NOTE_REFERENCE_KINDS as readonly string[]).includes(kind)) {
      throw new NoteReferenceUnsupportedKindException(kind);
    }
    return kind as NoteReferenceKind;
  }

  /** Rejects a pinned relation to something that is not there, so the header cannot lie. */
  async assertExists(kind: NoteReferenceKind, id: number): Promise<NoteReferenceTarget> {
    const [target] = await this.resolve([{ kind, id }]);
    if (!target || !target.exists) throw new NoteReferenceTargetNotFoundException(kind, id);
    return target;
  }

  /**
   * Live names for a batch of references: one query per kind present, never one per row.
   *
   * Targets that no longer exist come back with `exists: false` and no label — the
   * caller fills in the snapshot it stored, which is the only record left of what the
   * chip used to say.
   */
  async resolve(
    refs: Array<{ kind: NoteReferenceKind; id: number }>,
  ): Promise<NoteReferenceTarget[]> {
    if (refs.length === 0) return [];

    const idsByKind = new Map<NoteReferenceKind, Set<number>>();
    for (const ref of refs) {
      const bucket = idsByKind.get(ref.kind) ?? new Set<number>();
      bucket.add(ref.id);
      idsByKind.set(ref.kind, bucket);
    }

    const resolved = new Map<TargetKey, NoteReferenceTarget>();
    await Promise.all(
      [...idsByKind.entries()].map(async ([kind, ids]) => {
        for (const target of await this.resolveKind(kind, [...ids])) {
          resolved.set(key(target.kind, target.id), target);
        }
      }),
    );

    // Deduplicated in the same order the caller asked, with a placeholder for anything
    // that vanished, so a caller can zip the result back onto its own rows.
    const seen = new Set<TargetKey>();
    const out: NoteReferenceTarget[] = [];
    for (const ref of refs) {
      const id = key(ref.kind, ref.id);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(
        resolved.get(id) ?? { kind: ref.kind, id: ref.id, label: '', sublabel: null, exists: false },
      );
    }
    return out;
  }

  private async resolveKind(
    kind: NoteReferenceKind,
    ids: number[],
  ): Promise<NoteReferenceTarget[]> {
    switch (kind) {
      case 'lead': {
        const rows = await this.leads.find({
          where: { id: In(ids) },
          select: { id: true, name: true, leadNumber: true },
        });
        return rows.map((row) => ({
          kind,
          id: row.id,
          label: row.name?.trim() || row.leadNumber || `Lead #${row.id}`,
          sublabel: row.leadNumber ?? null,
          exists: true,
        }));
      }

      case 'project': {
        // A project has no name of its own: it is named after the lead it came from.
        const rows = await this.projects.find({ where: { id: In(ids) }, relations: ['lead'] });
        return rows.map((row) => ({
          kind,
          id: row.id,
          label: row.lead?.name?.trim() || row.lead?.leadNumber || `Project #${row.id}`,
          sublabel: row.lead?.leadNumber ?? null,
          exists: true,
        }));
      }

      case 'contact': {
        const rows = await this.contacts.find({
          where: { id: In(ids) },
          select: { id: true, name: true, email: true },
        });
        return rows.map((row) => ({
          kind,
          id: row.id,
          label: row.name?.trim() || `Contact #${row.id}`,
          sublabel: row.email ?? null,
          exists: true,
        }));
      }

      case 'company': {
        const rows = await this.companies.find({
          where: { id: In(ids) },
          select: { id: true, name: true, email: true },
        });
        return rows.map((row) => ({
          kind,
          id: row.id,
          label: row.name?.trim() || `Company #${row.id}`,
          sublabel: row.email ?? null,
          exists: true,
        }));
      }

      case 'task': {
        const rows = await this.tasks.find({
          where: { id: In(ids) },
          select: { id: true, title: true, status: true },
        });
        return rows.map((row) => ({
          kind,
          id: row.id,
          label: row.title?.trim() || `Task #${row.id}`,
          sublabel: row.status ?? null,
          exists: true,
        }));
      }

      case 'user': {
        const rows = await this.users.find({
          where: { id: In(ids) },
          select: { id: true, name: true, email: true },
        });
        return rows.map((row) => ({
          kind,
          id: row.id,
          label: row.name?.trim() || row.email,
          sublabel: row.email,
          exists: true,
        }));
      }

      case 'note': {
        // Visibility is deliberately not applied: this resolves a label the caller is
        // already showing a row for, and the rows themselves were filtered when they
        // were listed. Trashed notes do resolve — a mention of a note someone threw
        // away should read "Site survey", not "(deleted)", because restoring it brings
        // the link back.
        const rows = await this.notes.find({
          where: { id: In(ids) },
          select: { id: true, title: true, icon: true },
        });
        return rows.map((row) => ({
          kind,
          id: row.id,
          label: row.title?.trim() || 'Untitled',
          sublabel: row.icon ?? null,
          exists: true,
        }));
      }
    }
  }

  /**
   * The mention picker's search: everything matching `query`, across the kinds asked for.
   *
   * One query per kind, capped per kind rather than overall, so typing "ma" cannot fill
   * the whole list with leads and hide the one contact. The caller keeps the grouping.
   *
   * An empty query returns the most recent records of each kind — pressing `@` and
   * seeing nothing until you type reads as broken.
   */
  async search(
    query: string,
    kinds: NoteReferenceKind[],
    perKind: number,
    actor?: NoteActor,
  ): Promise<NoteReferenceTarget[]> {
    const results = await Promise.all(
      kinds.map((kind) => this.searchKind(kind, query.trim(), perKind, actor)),
    );
    return results.flat();
  }

  private async searchKind(
    kind: NoteReferenceKind,
    query: string,
    limit: number,
    actor?: NoteActor,
  ): Promise<NoteReferenceTarget[]> {
    const term = likeTerm(query);
    const filtered = query.length > 0;

    switch (kind) {
      case 'lead': {
        const qb = this.leads
          .createQueryBuilder('lead')
          .select(['lead.id', 'lead.name', 'lead.leadNumber'])
          .orderBy('lead.id', 'DESC')
          .limit(limit);
        if (filtered) {
          qb.where('lead.name ILIKE :term OR lead.lead_number ILIKE :term', { term });
        }
        const rows = await qb.getMany();
        return rows.map((row) => ({
          kind,
          id: row.id,
          label: row.name?.trim() || row.leadNumber || `Lead #${row.id}`,
          sublabel: row.leadNumber ?? null,
          exists: true,
        }));
      }

      case 'project': {
        const qb = this.projects
          .createQueryBuilder('project')
          .innerJoinAndSelect('project.lead', 'lead')
          .orderBy('project.id', 'DESC')
          .limit(limit);
        if (filtered) {
          qb.where('lead.name ILIKE :term OR lead.lead_number ILIKE :term', { term });
        }
        const rows = await qb.getMany();
        return rows.map((row) => ({
          kind,
          id: row.id,
          label: row.lead?.name?.trim() || row.lead?.leadNumber || `Project #${row.id}`,
          sublabel: row.lead?.leadNumber ?? null,
          exists: true,
        }));
      }

      case 'contact': {
        const qb = this.contacts
          .createQueryBuilder('contact')
          .select(['contact.id', 'contact.name', 'contact.email'])
          .orderBy('contact.name', 'ASC')
          .limit(limit);
        if (filtered) {
          qb.where('contact.name ILIKE :term OR contact.email ILIKE :term', { term });
        }
        const rows = await qb.getMany();
        return rows.map((row) => ({
          kind,
          id: row.id,
          label: row.name?.trim() || `Contact #${row.id}`,
          sublabel: row.email ?? null,
          exists: true,
        }));
      }

      case 'company': {
        const qb = this.companies
          .createQueryBuilder('company')
          .select(['company.id', 'company.name', 'company.email'])
          .orderBy('company.name', 'ASC')
          .limit(limit);
        if (filtered) {
          qb.where('company.name ILIKE :term OR company.email ILIKE :term', { term });
        }
        const rows = await qb.getMany();
        return rows.map((row) => ({
          kind,
          id: row.id,
          label: row.name?.trim() || `Company #${row.id}`,
          sublabel: row.email ?? null,
          exists: true,
        }));
      }

      case 'task': {
        const qb = this.tasks
          .createQueryBuilder('task')
          .select(['task.id', 'task.title', 'task.status'])
          .where('task.deleted_at IS NULL')
          .orderBy('task.updated_at', 'DESC')
          .limit(limit);
        if (filtered) qb.andWhere('task.title ILIKE :term', { term });
        const rows = await qb.getMany();
        return rows.map((row) => ({
          kind,
          id: row.id,
          label: row.title?.trim() || `Task #${row.id}`,
          sublabel: row.status ?? null,
          exists: true,
        }));
      }

      case 'user': {
        // Deactivated colleagues are left out: mentioning someone who has left is a
        // dead link the moment it is written.
        const qb = this.users
          .createQueryBuilder('user')
          .select(['user.id', 'user.name', 'user.email'])
          .where('user.is_active = true')
          .orderBy('user.name', 'ASC')
          .limit(limit);
        if (filtered) {
          qb.andWhere('(user.name ILIKE :term OR user.email ILIKE :term)', { term });
        }
        const rows = await qb.getMany();
        return rows.map((row) => ({
          kind,
          id: row.id,
          label: row.name?.trim() || row.email,
          sublabel: row.email,
          exists: true,
        }));
      }

      case 'note': {
        // Titles only, not full text: `[[` is for "link to the note called X", and a
        // body match would offer pages whose titles do not resemble what was typed.
        // Folders are offered too — linking to one is linking to a section.
        const qb = this.notes
          .createQueryBuilder('page')
          .select(['page.id', 'page.title', 'page.icon'])
          .where('page.deleted_at IS NULL')
          .orderBy('page.updated_at', 'DESC')
          .limit(limit);
        if (filtered) qb.andWhere('page.title ILIKE :term', { term });
        if (actor) {
          qb.andWhere(NotesRepository.visibleCondition(actor.roleId), {
            userId: actor.id,
            roleId: actor.roleId,
          });
        }
        const rows = await qb.getMany();
        return rows.map((row) => ({
          kind,
          id: row.id,
          label: row.title?.trim() || 'Untitled',
          sublabel: row.icon ?? null,
          exists: true,
        }));
      }
    }
  }
}
