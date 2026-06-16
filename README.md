# Atari ST Floppy Image Toolkit & GEM Workbench
<img width="1366" height="768" alt="image" src="https://github.com/user-attachments/assets/231e6ea9-fcbb-4999-84aa-c6bc14e722ee" />
A visually rich, full-featured retro Atari ST Desktop environment running entirely in your browser. This application replicates the classic **Digital Research GEM (Graphical Environment Manager)** interface of the Atari ST, complete with a suite of vintage tools for floppy disk image inspection, binary unpacking, ROM burning preparation, boot sector virus scanning, chip music playback, and a fully interactive Atari ST Emulator!

---

## 🖥️ Interactive GEM Workbench Tools

The toolkit is modeled as standard floating, resizable, and draggable GEM windows. Double-click icons or use the top menu bar to open and close them:

### 1. Floppy Disk Manager & Info Panel
* **FAT12 File System Support:** Read, list, extract, insert, and delete files inside virtual floppy disk images (`.st` or `.msa` format).
* **MSA (Magic Shadow Archiver) Support:** Automatically decompress and parse MSA disk images.
* **Cluster Visualization Map:** A real-time visual grid of disk sectors/clusters showing FAT allocation chains, file layouts, and empty spaces. Mouse over sectors to trace allocation.

### 2. Atari ST Emulator (`estyJS` Port)
* **Live In-Browser Emulation:** Boot a fully operational virtual Atari ST directly within your GEM workbench.
* **Multiple OS Images:** Choose between built-in ROM variants, including **EmuTOS** (`emutos.img`) and classic European/US TOS ROMs (`etos256uk.img`, `etos256us.img`).
* **Disk Hot-Swapping:** Feed loaded `.st` or `.msa` disk images directly into the emulator's virtual floppy drive A: in real-time.

### 3. Boot Block Creator
* **Custom Boot Sectors:** Construct standard, executable, or virus-protected Atari ST floppy boot blocks.
* **Boot Code Injection:** Inject custom executable routines into the boot sector for custom hardware behavior or nostalgic demos.

### 4. Depacking Engine (MSA, RNC, Pack-Ice, ICE, Atomik, Automation, JEM, JAK etc.)
* **Automatic Decompression & Identification:** Detects historical Atari ST crunchers, executable packers, and self-extracting stubs. Supported algorithms include:
  * **Pack-Ice (ICE! / Ice!):** Legendary demoscene and crack packer.
  * **Atomik Cruncher (ATM3 / ATM5 / ATOMIC):** High-efficiency classic Atari ST cruncher.
  * **Automation Packer & Compacter:** Notorious multi-file packer from disk-magazine groups.
  * **The JAM Packer / JEM:** Popular file packers used on games and intros.
  * **JAK / Jek Packer / Cynix DPAK:** Retro binary packers used by cracking crews (such as Cynix, JEK, and others).
  * **Rob Northen Copier (RNC 1/2):** Industry-standard gaming compression routine used by commercial releases.
* **File Rescue:** Extract crunched executable files `.PRG` back to their uncompressed states.

### 5. File Viewer & Graphics Decoder
* **Multi-Format Decoder:** View files as standard text, raw hex-dumps, or automatically decode Atari ST-compatible retro graphics formats:
  * **DEGAS & DEGAS Elite** (`.PI1`, `.PC1` format)
  * **NeoChrome** (`.NEO` format)
  * Custom low-res planar sprite extractions.

### 6. ROM Splitter & Merger
* **EPROM Preparation:** Split physical Atari ST 192KB, 256KB, or 512KB TOS ROMs into High (`HI`) and Low (`LO`) byte binaries for physical IC burning on programmers.
* **Reconstruction:** Merge split `HI` and `LO` byte segments back into unified executable ROM files.

### 7. Sector Editor
* **Low-Level Access:** Inspect and modify raw bytes sector-by-sector.
* **Interactive Grid:** Safely edit sector hex or ASCII characters directly on the grid and rewrite them back to the virtual disk layout.

### 8. Sound & YM Player
* **Vintage Music:** Includes a chip sound emulator capable of parsing and playing legacy Atari chip formats such as **YM** (Yamaha YM2149 sound chip registers).

### 9. Boot Sector Virus Scanner
* **Retro-Safety Protection:** Scan loaded floppy disk boot sectors for signature patterns of historical Atari ST boot sector viruses (e.g., Ghost, Signum, Bee, etc.). Easily immunize infected boot blocks.

---

## 💾 Supported File Types & Formats

This toolkit features built-in encoders, decoders, and parsers for a wide variety of retro 16-bit Atari formats:

| Category | Extensions | Format / System Name | Details & Capabilities in Toolkit |
| :--- | :--- | :--- | :--- |
| **Floppy Disk Images** | `.st` | Standard Atari Disk Image | Raw sector-by-sector floppy dump with classic FAT12 filesystem. Mounts folder-structures, permits read/write injection. |
| | `.msa` | Magic Shadow Archiver | Compressed Atari floppy image. Read directly via built-in sub-sector decompression engine. |
| | `.zip` | Zip Compressed Archive | Explored or packaged using integrated browser-side decompression pipelines. |
| **Executable Packers** | `.prg`, `.tos` | Rob Northen Copier (RNC 1/2) | Auto-detects RNC signatures. Extracts crunched game binaries back to their original size. |
| | `.prg`, `.tos` | Pack-Ice (ICE! / Ice!) | Full signature detection and decompression for classic ICE! / Ice! demoscene executables. |
| | `.prg`, `.tos` | Atomik Cruncher (ATM3/ATM5/ATOMIC) | Identifies classic ATM3, ATM5, and ATOMIC crunch flags and self-extracting code runs. |
| | `.prg`, `.tos` | Automation Compacter | Identifies Automation packer formats and compact/crack loaders from famous compilations. |
| | `.prg`, `.tos` | The JAM Packer / JEM | Detects the magical JEM or JAM! executable tags and extracts corresponding program files. |
| | `.prg`, `.tos` | JAK / Jek / Cynix DPAK / Byte Killer | Scans and recognizes customized cracking/intro crew self-extracting stubs and packers. |
| **Retro Retro-Graphics** | `.pi1`, `.pc1` | DEGAS & DEGAS Elite | Low-resolution (320x200, 16-color) paint canvas files. Decodes 16-bit planar screens and original color palettes. |
| | `.neo` | NeoChrome Image | Classic 16-color low-res bitplane images from the early Atari graphics suites. |
| **Sound & PSG Chips** | `.ym` | YM Chip Music File | Streams raw registers to the Yamaha YM2149 PSG chip visual audio emulator. |
| **Atari System ROMs** | `.img`, `.rom`, `.bin`| Operating System TOS ROM | Supports 192KB, 256KB, and 512KB binaries. Enables custom splitting (Odd/Even bytes) and merging for physical EPROM burning. |

---

## 📖 User Manual & How-to Guide

### Loading and Managing Floppy Images
1. Click **File** on the GEM menu bar or select the Floppy icons on the desktop.
2. Drag-and-drop or upload a `.st` or `.msa` file into the main Floppy window.
3. Browse the directory. Double-click on `.PRG`, `.TOS`, `.TXT`, or `.PI1` files to run, view or decode them!
4. To add files to the floppy image, click **Add File** inside the floppy window and upload any asset from your computer.

### Swapping Disks in the Emulator
1. Open the **Atari ST Emulator** from the GEM **Desk** or **System** menu.
2. Load any Atari ST floppy image (`.st`/`.msa`) into the Floppy Disk Manager.
3. Press **Insert Loaded Floppy into Emulator** or hit floppy drive swap inside the emulation interface.
4. The emulator will automatically reset-boot or mount the floppy in drive `A:`. Use EmuTOS desktop to direct-launch games or utilities!

### Splitting and Burning ROMs
1. Open the **ROM Splitter** window.
2. Upload a standard unified TOS ROM file.
3. Click **Split ROM**. The toolkit split engine outputs two `.BIN` components: `TOS_HI` containing odd-byte words and `TOS_LO` containing even-byte words.
4. Save both files to burn physically onto EPROM chips (e.g., 27C256 or similar).

---

## 🛠️ Build and Development Guide

### Prerequisites
* **Node.js** (v18.x or above recommended)
* **npm** (v9.x or above)

### 1. Installation
Clone the repository, navigate into the project directory, and install all package dependencies:
```bash
npm install
```

### 2. Live Development Server
Start the local Vite development server. This will bind to port `3000` and host `0.0.0.0` as configured for instant iframe testing:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) inside your browser.

### 3. Production Build
Prepare an optimized distribution bundle in the `dist/` directory:
```bash
npm run build
```
This runs the full Vite assets pipeline, compiling TypeScript, Tailwind CSS styles, and packaging the frontend workspace.

### 4. Running the Production Build
To spin up a local server hosting the static distribution files, run:
```bash
npm run preview
```

### 🗃️ Environment Configurations (`.env.example`)
To configure customized server-side proxy environments, create a `.env` file copying the `.env.example` structure:
* `GEMINI_API_KEY`: API credentials for optional advanced Gemini features.
* `APP_URL`: Hosted URL mapping.

---
*Created as a part of the Google AI Studio Workbench. Enjoy the 16-bit desktop magic!*
