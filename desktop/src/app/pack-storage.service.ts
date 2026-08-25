import { invoke } from "@tauri-apps/api/core";
import { GamePack, PackSummary, PacksListing } from "./pack.models";

export class PackStorageService {
  async list(): Promise<PacksListing> { return invoke<PacksListing>("list_packs"); }

  async load(fileName: string): Promise<GamePack> { return invoke<GamePack>("load_pack", { fileName }); }

  async save(pack: GamePack): Promise<PackSummary> { return invoke<PackSummary>("save_pack", { pack }); }
}
