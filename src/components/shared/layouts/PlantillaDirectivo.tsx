import Header from "./Header";
import { RequestCookie } from "next/dist/compiled/@edge-runtime/cookies";
import SidebarDirectivo from "./sidebars/SidebarDirectivo";
import { RolesSistema } from "@/interfaces/RolesSistema";

const PlantillaDirectivo = ({
  children,
  Nombres,
  Apellidos,
  Google_Drive_Foto_ID,
}: {
  children: React.ReactNode;
  Nombres: RequestCookie;
  Apellidos: RequestCookie;
  Google_Drive_Foto_ID: RequestCookie | undefined;
}) => {
  return (
    <section className="max-w-screen grid  grid-rows-[min-content_1fr] min-h-[100dvh] -border-2 border-blue-500">
      <Header
        Nombres={Nombres}
        Apellidos={Apellidos}
        Rol={RolesSistema.Directivo}
        Google_Drive_Foto_ID={Google_Drive_Foto_ID}
      />
      <div className="w-full -border-2 border-green-900 flex relative top-0">
        <SidebarDirectivo />

        <main className="-border-2 border-black flex-1 h-full py-4 px-8">
          {children}
        </main>
      </div>
    </section>
  );
};

export default PlantillaDirectivo;
