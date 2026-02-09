import { Logger } from '@nestjs/common';

/**
 * Ejecuta una tarea en background sin bloquear la respuesta al cliente
 * Usa setImmediate para ejecutar después de que la respuesta se haya enviado
 * 
 * @param task - Función async a ejecutar en background
 * @param taskName - Nombre descriptivo de la tarea para logging
 * @param logger - Logger opcional para registrar errores
 */
export function executeInBackground(
  task: () => Promise<void>,
  taskName: string,
  logger?: Logger,
): void {
  setImmediate(async () => {
    try {
      await task();
    } catch (error: any) {
      const errorMessage = error?.message || 'Unknown error';
      const errorStack = error?.stack;
      
      if (logger) {
        logger.error(`Error in background task ${taskName}: ${errorMessage}`, errorStack);
      } else {
        console.error(`Error in background task ${taskName}: ${errorMessage}`, errorStack);
      }
      // No re-throw - las tareas en background no deben afectar la respuesta
    }
  });
}
