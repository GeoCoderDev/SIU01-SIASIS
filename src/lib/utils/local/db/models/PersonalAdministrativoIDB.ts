import { PersonalAdministrativoSinContraseña } from "@/interfaces/shared/apis/shared/others/types";
import IndexedDBConnection from "../IndexedDBConnection";
import {
  TablasSistema,
  ITablaInfo,
  TablasLocal,
} from "../../../../../interfaces/shared/TablasSistema";
import {
  ApiResponseBase,
  ErrorResponseAPIBase,
  MessageProperty,
} from "@/interfaces/shared/apis/types";
import AllErrorTypes, {
  DataConflictErrorTypes,
  SystemErrorTypes,
  UserErrorTypes,
} from "../../../../../interfaces/shared/apis/errors";
import { SiasisAPIS } from "@/interfaces/shared/SiasisComponents";
import comprobarSincronizacionDeTabla from "@/lib/helpers/validations/comprobarSincronizacionDeTabla";
import fetchSiasisApiGenerator from "@/lib/helpers/generators/fetchSiasisApisGenerator";
import ultimaActualizacionTablasLocalesIDB from "./UltimaActualizacionTablasLocalesIDB";
import { DatabaseModificationOperations } from "@/interfaces/shared/DatabaseModificatioOperations";
import { GetPersonalAdministrativoSuccessResponse } from "@/interfaces/shared/apis/api01/personal-administrativo/types";

// Tipo para la entidad (sin atributos de fechas)
export type IPersonalAdministrativoLocal = PersonalAdministrativoSinContraseña;

export interface IPersonalAdministrativoFilter {
  DNI_Personal_Administrativo?: string;
  Nombres?: string;
  Apellidos?: string;
  Estado?: boolean;
  Cargo?: string;
}

export class PersonalAdministrativoIDB {
  private tablaInfo: ITablaInfo = TablasSistema.PERSONAL_ADMINISTRATIVO;
  private nombreTablaLocal: string =
    this.tablaInfo.nombreLocal || "personal_administrativo";

  constructor(
    private siasisAPI: SiasisAPIS,
    private setIsSomethingLoading: (isLoading: boolean) => void,
    private setError: (error: ErrorResponseAPIBase | null) => void,
    private setSuccessMessage?: (message: MessageProperty | null) => void
  ) {}

  /**
   * Método de sincronización que se ejecutará al inicio de cada operación
   */
  private async sync(): Promise<void> {
    try {
      const debeSincronizar = await comprobarSincronizacionDeTabla(
        this.tablaInfo,
        "API01"
      );

      if (!debeSincronizar) {
        // No es necesario sincronizar
        return;
      }

      // Si llegamos aquí, debemos sincronizar
      await this.fetchYActualizarPersonalAdministrativo();
    } catch (error) {
      console.error(
        "Error durante la sincronización de personal administrativo:",
        error
      );
      this.handleIndexedDBError(error, "sincronizar personal administrativo");
    }
  }

  /**
   * Obtiene el personal administrativo desde la API y los actualiza localmente
   * @returns Promise que se resuelve cuando el personal administrativo ha sido actualizado
   */
  private async fetchYActualizarPersonalAdministrativo(): Promise<void> {
    try {
      // Usar el generador para API01 (o la que corresponda)
      const { fetchSiasisAPI } = fetchSiasisApiGenerator(this.siasisAPI);

      // Realizar la petición al endpoint
      const fetchCancelable = await fetchSiasisAPI({
        endpoint: "/api/personal-administrativo",
        method: "GET",
      });

      if (!fetchCancelable) {
        throw new Error(
          "No se pudo crear la petición de personal administrativo"
        );
      }

      // Ejecutar la petición
      const response = await fetchCancelable.fetch();

      if (!response.ok) {
        throw new Error(
          `Error al obtener personal administrativo: ${response.statusText}`
        );
      }

      const objectResponse = (await response.json()) as ApiResponseBase;

      if (!objectResponse.success) {
        throw new Error(
          `Error en respuesta de personal administrativo: ${objectResponse.message}`
        );
      }

      // Extraer el personal administrativo del cuerpo de la respuesta
      const { data: personalAdministrativo } = objectResponse as GetPersonalAdministrativoSuccessResponse;

      // Actualizar personal administrativo en la base de datos local
      await this.upsertFromServer(personalAdministrativo);

      // Registrar la actualización en UltimaActualizacionTablasLocalesIDB
      await ultimaActualizacionTablasLocalesIDB.registrarActualizacion(
        this.tablaInfo.nombreLocal as TablasLocal,
        DatabaseModificationOperations.UPDATE
      );

      console.log(
        `Actualizados ${personalAdministrativo.length} miembros del personal administrativo desde la API`
      );
    } catch (error) {
      console.error(
        "Error al obtener y actualizar personal administrativo:",
        error
      );

      // Determinar el tipo de error
      let errorType: AllErrorTypes = SystemErrorTypes.UNKNOWN_ERROR;
      let message = "Error al sincronizar personal administrativo";

      if (error instanceof Error) {
        // Si es un error de red o problemas de conexión
        if (
          error.message.includes("network") ||
          error.message.includes("fetch")
        ) {
          errorType = SystemErrorTypes.EXTERNAL_SERVICE_ERROR;
          message = "Error de red al sincronizar personal administrativo";
        }
        // Si es un error relacionado con la respuesta del servidor
        else if (error.message.includes("obtener personal administrativo")) {
          errorType = SystemErrorTypes.EXTERNAL_SERVICE_ERROR;
          message = error.message;
        }
        // Si es un error de IndexedDB
        else if (
          error.name === "TransactionInactiveError" ||
          error.name === "QuotaExceededError"
        ) {
          errorType = SystemErrorTypes.DATABASE_ERROR;
          message =
            "Error de base de datos al sincronizar personal administrativo";
        } else {
          message = error.message;
        }
      }

      // Establecer el error en el estado global
      this.setError({
        success: false,
        message: message,
        errorType: errorType,
        details: {
          origen:
            "PersonalAdministrativoIDB.fetchYActualizarPersonalAdministrativo",
          timestamp: Date.now(),
        },
      });

      throw error;
    }
  }

  /**
   * Obtiene todo el personal administrativo
   * @param includeInactive Si es true, incluye personal inactivo
   * @returns Promesa con el array de personal administrativo
   */
  public async getAll(
    includeInactive: boolean = true
  ): Promise<IPersonalAdministrativoLocal[]> {
    this.setIsSomethingLoading(true);
    this.setError(null); // Limpiar errores anteriores
    this.setSuccessMessage?.(null); // Limpiar mensajes anteriores

    try {
      // Ejecutar sincronización antes de la operación
      await this.sync();

      // Obtener el store
      const store = await IndexedDBConnection.getStore(this.nombreTablaLocal);

      // Convertir la API de callbacks de IndexedDB a promesas
      const result = await new Promise<IPersonalAdministrativoLocal[]>(
        (resolve, reject) => {
          const request = store.getAll();

          request.onsuccess = () =>
            resolve(request.result as IPersonalAdministrativoLocal[]);
          request.onerror = () => reject(request.error);
        }
      );

      // Filtrar inactivos si es necesario
      const personalAdministrativo = includeInactive
        ? result
        : result.filter((personal) => personal.Estado === true);

      // Mostrar mensaje de éxito con información relevante
      if (personalAdministrativo.length > 0) {
        this.handleSuccess(
          `Se encontraron ${personalAdministrativo.length} miembros del personal administrativo`
        );
      } else {
        this.handleSuccess("No se encontró personal administrativo");
      }

      this.setIsSomethingLoading(false);
      return personalAdministrativo;
    } catch (error) {
      this.handleIndexedDBError(
        error,
        "obtener lista de personal administrativo"
      );
      this.setIsSomethingLoading(false);
      return []; // Devolvemos array vacío en caso de error
    }
  }

  /**
   * Actualiza o crea personal administrativo en lote desde el servidor
   * @param personalAdministrativoServidor Personal administrativo proveniente del servidor
   * @returns Conteo de operaciones: creados, actualizados, errores
   */
  private async upsertFromServer(
    personalAdministrativoServidor: PersonalAdministrativoSinContraseña[]
  ): Promise<{ created: number; updated: number; errors: number }> {
    const result = { created: 0, updated: 0, errors: 0 };

    // Procesar en lotes para evitar transacciones demasiado largas
    const BATCH_SIZE = 20;

    for (
      let i = 0;
      i < personalAdministrativoServidor.length;
      i += BATCH_SIZE
    ) {
      const lote = personalAdministrativoServidor.slice(i, i + BATCH_SIZE);

      // Para cada miembro del personal administrativo en el lote
      for (const personalServidor of lote) {
        try {
          // Verificar si ya existe el personal administrativo
          const existePersonal = await this.getByDNI(
            personalServidor.DNI_Personal_Administrativo
          );

          // Obtener un store fresco para cada operación
          const store = await IndexedDBConnection.getStore(
            this.nombreTablaLocal,
            "readwrite"
          );

          // Ejecutar la operación put
          await new Promise<void>((resolve, reject) => {
            const request = store.put(personalServidor);

            request.onsuccess = () => {
              if (existePersonal) {
                result.updated++;
              } else {
                result.created++;
              }
              resolve();
            };

            request.onerror = () => {
              result.errors++;
              console.error(
                `Error al guardar personal administrativo ${personalServidor.DNI_Personal_Administrativo}:`,
                request.error
              );
              reject(request.error);
            };
          });
        } catch (error) {
          result.errors++;
          console.error(
            `Error al procesar personal administrativo ${personalServidor.DNI_Personal_Administrativo}:`,
            error
          );
        }
      }

      // Dar un pequeño respiro al bucle de eventos entre lotes
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    return result;
  }

  /**
   * Obtiene un miembro del personal administrativo por su DNI
   * @param dni DNI del personal administrativo
   * @returns Personal administrativo encontrado o null
   */
  public async getByDNI(
    dni: string
  ): Promise<IPersonalAdministrativoLocal | null> {
    try {
      const store = await IndexedDBConnection.getStore(this.nombreTablaLocal);

      return new Promise<IPersonalAdministrativoLocal | null>(
        (resolve, reject) => {
          const request = store.get(dni);

          request.onsuccess = () => {
            resolve(request.result || null);
          };

          request.onerror = () => {
            reject(request.error);
          };
        }
      );
    } catch (error) {
      console.error(
        `Error al obtener personal administrativo con DNI ${dni}:`,
        error
      );
      this.handleIndexedDBError(
        error,
        `obtener personal administrativo con DNI ${dni}`
      );
      return null;
    }
  }

  /**
   * Obtiene personal administrativo por cargo
   * @param cargo Cargo del personal administrativo
   * @returns Array con el personal administrativo que coincide con el cargo
   */
  public async getByCargo(
    cargo: string
  ): Promise<IPersonalAdministrativoLocal[]> {
    try {
      const store = await IndexedDBConnection.getStore(this.nombreTablaLocal);
      const index = store.index("por_cargo");

      return new Promise<IPersonalAdministrativoLocal[]>((resolve, reject) => {
        const request = index.getAll(cargo);

        request.onsuccess = () => {
          resolve(request.result as IPersonalAdministrativoLocal[]);
        };

        request.onerror = () => {
          reject(request.error);
        };
      });
    } catch (error) {
      console.error(
        `Error al obtener personal administrativo con cargo ${cargo}:`,
        error
      );
      this.handleIndexedDBError(
        error,
        `obtener personal administrativo con cargo ${cargo}`
      );
      return [];
    }
  }

  /**
   * Establece un mensaje de éxito
   * @param message Mensaje de éxito
   */
  private handleSuccess(message: string): void {
    const successResponse: MessageProperty = { message };
    this.setSuccessMessage?.(successResponse);
  }

  /**
   * Maneja los errores de operaciones con IndexedDB
   * @param error El error capturado
   * @param operacion Nombre de la operación que falló
   */
  private handleIndexedDBError(error: unknown, operacion: string): void {
    console.error(`Error en operación IndexedDB (${operacion}):`, error);

    let errorType: AllErrorTypes = SystemErrorTypes.UNKNOWN_ERROR;
    let message = `Error al ${operacion}`;

    if (error instanceof Error) {
      // Intentar categorizar el error según su mensaje o nombre
      if (error.name === "ConstraintError") {
        errorType = DataConflictErrorTypes.VALUE_ALREADY_IN_USE;
        message = `Error de restricción al ${operacion}: valor duplicado`;
      } else if (error.name === "NotFoundError") {
        errorType = UserErrorTypes.USER_NOT_FOUND;
        message = `No se encontró el recurso al ${operacion}`;
      } else if (error.name === "QuotaExceededError") {
        errorType = SystemErrorTypes.DATABASE_ERROR;
        message = `Almacenamiento excedido al ${operacion}`;
      } else if (error.name === "TransactionInactiveError") {
        errorType = SystemErrorTypes.DATABASE_ERROR;
        message = `Transacción inactiva al ${operacion}`;
      } else {
        // Si no podemos categorizar específicamente, usamos el mensaje del error
        message = error.message || message;
      }
    }

    this.setError({
      success: false,
      message: message,
      errorType: errorType,
    });
  }
}


