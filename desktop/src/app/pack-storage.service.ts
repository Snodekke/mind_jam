import { invoke } from "@tauri-apps/api/core";
import { GamePack, PackSummary, PacksListing } from "./pack.models";

export class PackStorageService {
  async list(): Promise<PacksListing> { return invoke<PacksListing>("list_packs"); }

  async setDirectory(directoryPath: string): Promise<PacksListing> {
    return invoke<PacksListing>("set_packs_directory", { directoryPath });
  }

  async load(fileName: string): Promise<GamePack> { return invoke<GamePack>("load_pack", { fileName }); }

  async save(pack: GamePack): Promise<PackSummary> { return invoke<PackSummary>("save_pack", { pack }); }

  async import(sourcePath: string): Promise<PackSummary> { return invoke<PackSummary>("import_pack", { sourcePath }); }

  async export(fileName: string, directoryPath: string): Promise<string> {
    return invoke<string>("export_pack", { fileName, directoryPath });
  }

  async delete(fileName: string): Promise<void> { return invoke<void>("delete_pack", { fileName }); }
}
