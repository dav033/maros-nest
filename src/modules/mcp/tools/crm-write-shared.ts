import { jsonContent } from './shared';

export function deletedMessage(entity: string, id: number) {
  return jsonContent({ message: `${entity} ${id} deleted successfully` });
}
