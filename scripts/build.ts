#!/usr/bin/env -S deno run --allow-read --allow-write
// Build script to compile TypeScript files to JavaScript

import { walk } from "https://deno.land/std@0.208.0/fs/walk.ts";
import { join, dirname, relative } from "https://deno.land/std@0.208.0/path/mod.ts";
import { ensureDir } from "https://deno.land/std@0.208.0/fs/ensure_dir.ts";

const PROJECT_ROOT = Deno.cwd();
const SRC_DIR = join(PROJECT_ROOT, "src");

async function compileTypeScript(filePath: string): Promise<void> {
  try {
    console.log(`Compiling: ${relative(PROJECT_ROOT, filePath)}`);
    
    // Read the TypeScript file
    const tsContent = await Deno.readTextFile(filePath);
    
    // Use Deno's built-in TypeScript compiler
    const result = await Deno.emit(filePath, {
      bundle: false,
      check: false,
      compilerOptions: {
        target: "ES2020",
        module: "ES2020",
        moduleResolution: "node",
        allowJs: true,
        declaration: false,
        outDir: undefined,
      },
      sources: {
        [filePath]: tsContent,
      },
    });

    // Get the JavaScript output
    const jsCode = result.files[filePath.replace(/\.ts$/, ".js")];
    if (!jsCode) {
      throw new Error("No JavaScript output generated");
    }

    // Determine output path (.ts -> .mjs)
    const outputPath = filePath.replace(/\.ts$/, ".mjs");
    
    // Ensure output directory exists
    await ensureDir(dirname(outputPath));
    
    // Write the compiled JavaScript
    await Deno.writeTextFile(outputPath, jsCode);
    
    console.log(`  -> ${relative(PROJECT_ROOT, outputPath)}`);
  } catch (error) {
    console.error(`Failed to compile ${filePath}:`, error);
    throw error;
  }
}

async function buildAll(): Promise<void> {
  console.log("Building TypeScript files...");
  
  const tsFiles: string[] = [];
  
  // Find all TypeScript files in src directory
  for await (const entry of walk(SRC_DIR, { 
    exts: [".ts"], 
    includeDirs: false 
  })) {
    // Skip declaration files
    if (!entry.path.endsWith(".d.ts")) {
      tsFiles.push(entry.path);
    }
  }

  if (tsFiles.length === 0) {
    console.log("No TypeScript files found to compile.");
    return;
  }

  console.log(`Found ${tsFiles.length} TypeScript files to compile.`);

  // Compile each file
  for (const filePath of tsFiles) {
    await compileTypeScript(filePath);
  }

  console.log("Build completed successfully!");
}

if (import.meta.main) {
  try {
    await buildAll();
  } catch (error) {
    console.error("Build failed:", error);
    Deno.exit(1);
  }
}