const { Command } = require('commander');
const path = require('path');
const fs = require('fs');
const os = require('os');
const giget = require('giget');
const chalk = require('chalk');
const ora = require('ora');

const program = new Command();

// CONSTANTS
const AGENT_FOLDER = '.agent';
const DEFAULT_STORE = path.join(os.homedir(), '.antigravity');
const REGISTRY_FILE = '.sync-registry.json';

// UTILS
const log = (msg, quiet = false) => {
    if (!quiet) console.log(msg);
};

/**
 * Ensures the master GEMINI.md is present in the target .agent/rules directory.
 * If not present or outdated, restores it from internal assets.
 * @param {string} targetDir - The .agent directory path
 * @param {boolean} quiet - Silent mode
 */
const enforceGoldenRules = (targetDir, quiet = false) => {
    const rulesDir = path.join(targetDir, 'rules');
    const targetFile = path.join(rulesDir, 'GEMINI.md');
    const assetFile = path.join(__dirname, '..', 'assets', 'GEMINI.md');

    try {
        if (!fs.existsSync(rulesDir)) {
            fs.mkdirSync(rulesDir, { recursive: true });
        }

        if (fs.existsSync(assetFile)) {
            // Always overwrite to ensure enforcement of "The One Rule"
            fs.copyFileSync(assetFile, targetFile);
            log(chalk.cyan('󰈙 Golden Rules (GEMINI.md) enforced.'), quiet);
        }
    } catch (error) {
        if (!quiet) console.error(chalk.red(`Error enforcing Golden Rules: ${error.message}`));
    }
};

/**
 * Merge .agent folder from temp to global directory
 * @param {string} tempDir - Temp directory
 * @param {string} globalDir - Global .agent directory
 * @param {string} repoSource - Repository source identifier
 */
const mergeAgentFolder = (tempDir, globalDir, repoSource) => {
    let sourceAgent = path.join(tempDir, AGENT_FOLDER);
    let isRootSync = false;

    // Fallback: If .agent folder doesn't exist, use root folder but filter content
    if (!fs.existsSync(sourceAgent)) {
        // Check if common agent folders exist in root
        const commonFolders = ['skills', 'workflows', 'rules', 'scripts', 'docs', 'assets'];
        const hasCommonFolders = commonFolders.some(folder => fs.existsSync(path.join(tempDir, folder)));

        if (hasCommonFolders) {
            sourceAgent = tempDir; // Use root as source
            isRootSync = true;
        } else {
            throw new Error(`Could not find ${AGENT_FOLDER} folder or common agent folders (skills, workflows, scripts) in source repository!`);
        }
    }

    // Ensure global directory exists
    if (!fs.existsSync(globalDir)) {
        fs.mkdirSync(globalDir, { recursive: true });
    }

    // Load registry
    const registry = loadRegistry(globalDir);
    const kitId = repoSource.replace(/[^a-zA-Z0-9]/g, '_');

    if (!registry.kits[kitId]) {
        registry.kits[kitId] = {
            source: repoSource,
            installedAt: new Date().toISOString(),
            files: []
        };
    }

    registry.kits[kitId].lastUpdated = new Date().toISOString();

    // Recursively copy and merge files
    const copyRecursive = (src, dest, relativePath = '') => {
        const entries = fs.readdirSync(src, { withFileTypes: true });

        for (const entry of entries) {
            // Filter excluded files/folders when syncing from root
            if (isRootSync && relativePath === '') {
                const exclude = [
                    '.git', '.github', 'node_modules', 'package.json', 
                    'package-lock.json', '.gitignore', 'README.md', 'LICENSE',
                    'packages', 'assets', 'mcp_config.json', 'skills_index.json',
                    '.sync-registry.json', 'SECURITY.md', 'release_notes.md',
                    'CONTRIBUTING.md', 'CHANGELOG.md', 'CATALOG.md'
                ];
                if (exclude.includes(entry.name)) continue;
            }

            // Global exclusions (regardless of path depth)
            if (['docs', 'bin', 'lib', 'packages'].includes(entry.name)) continue;
            if (['SECURITY.md', 'release_notes.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'CATALOG.md'].includes(entry.name)) continue;


            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            const relPath = path.join(relativePath, entry.name);

            if (entry.isDirectory()) {
                if (!fs.existsSync(destPath)) {
                    fs.mkdirSync(destPath, { recursive: true });
                }
                copyRecursive(srcPath, destPath, relPath);
            } else {
                // Copy file (overwrite if exists)
                try {
                    fs.copyFileSync(srcPath, destPath);

                    // Track in registry
                    registry.files[relPath] = {
                        kit: kitId,
                        updatedAt: new Date().toISOString()
                    };

                    if (!registry.kits[kitId].files.includes(relPath)) {
                        registry.kits[kitId].files.push(relPath);
                    }
                } catch (err) {
                    // Ignore errors for locked files or permissions
                }
            }
        }
    };

    // Final cleanup of accidental internal copies (if sync didn't catch them)
    const cleanupExclusions = ['assets', 'skills_index.json', '.sync-registry.json'];
    const destAgentAssets = path.join(globalDir, 'assets');
    // Note: We don't want to delete globalDir/assets if it's our own enforcement asset,
    // but in a kit synchronization, if it copied an "assets" folder from the kit root, it's redundant.
    // However, the rule above (exclude.includes(entry.name)) already handles this for root syncs.

    copyRecursive(sourceAgent, globalDir);


    // Save updated registry
    saveRegistry(globalDir, registry);
};


/**
 * Generate skills_index.json from installed skills
 * @param {string} targetDir - The .agent directory
 * @param {boolean} quiet - Silent mode
 */
const generateSkillsIndex = (targetDir, quiet = false) => {
    const skillsDir = path.join(targetDir, 'skills');
    const indexPath = path.join(targetDir, 'skills_index.json');

    if (!fs.existsSync(skillsDir)) {
        if (!quiet) log(chalk.yellow('! No skills folder found to index.'));
        return;
    }

    const skills = [];

    const processDir = (currentPath, parentCategory = '') => {
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });
        
        // Check if this directory is a skill (has SKILL.md)
        const hasSkillMd = entries.some(e => e.name.toLowerCase() === 'skill.md');

        if (hasSkillMd) {
            const skillMdPath = path.join(currentPath, 'SKILL.md');
            const content = fs.readFileSync(skillMdPath, 'utf8');

            // Extraction using regex for frontmatter (avoiding extra deps)
            let name = path.basename(currentPath);
            let description = '';

            const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
            if (fmMatch) {
                const fm = fmMatch[1];
                const nameMatch = fm.match(/name:\s*(.*)/);
                const descMatch = fm.match(/description:\s*(.*)/);
                if (nameMatch) name = nameMatch[1].trim();
                if (descMatch) description = descMatch[1].trim();
            }

            // Path relative to workspace root (assuming .agent is in root)
            // But for skills_index.json, it usually expects the path relative to the .agent folder or absolute
            // In Antigravity context, skills_index.json paths are often relative to the workspace root (.agent/skills/...)
            const folderName = path.basename(currentPath);
            const技能Path = parentCategory ? `.agent/skills/${parentCategory}/${folderName}` : `.agent/skills/${folderName}`;

            skills.push({
                id: folderName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
                path: 技能Path,
                category: parentCategory || 'general',
                name: name,
                description: description,
                risk: 'low',
                source: 'local'
            });
        } else {
            // Recurse into subdirectories (max 1 level deep for categories)
            if (!parentCategory) {
                for (const entry of entries) {
                    if (entry.isDirectory() && !entry.name.startsWith('.')) {
                        processDir(path.join(currentPath, entry.name), entry.name);
                    }
                }
            }
        }
    };

    processDir(skillsDir);

    // Save index
    fs.writeFileSync(indexPath, JSON.stringify(skills, null, 2));
    if (!quiet) log(chalk.green(`✓ Generated skills index with ${skills.length} skills.`));
};

// ... (Rest of the file remains same, including registry functions and command definitions) ...

const loadRegistry = (globalDir) => {
    const registryPath = path.join(globalDir, REGISTRY_FILE);
    if (!fs.existsSync(registryPath)) {
        return { kits: {}, files: {} };
    }
    return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
};

const saveRegistry = (globalDir, registry) => {
    const registryPath = path.join(globalDir, REGISTRY_FILE);
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
};

// COMMANDS
const syncCommand = async (repoSource, options) => {
    const localMode = options.local || false;
    const targetDir = localMode ? path.join(process.cwd(), AGENT_FOLDER) : DEFAULT_STORE;
    
    // Header
    console.log(chalk.bold.blue('\n    ╔══════════════════════════════════════╗'));
    console.log(chalk.bold.blue('    ║        AG-JZ CLI                     ║'));
    console.log(chalk.bold.blue('    ║   Multi-Kit Antigravity Manager      ║'));
    console.log(chalk.bold.blue('    ╚══════════════════════════════════════╝\n'));

    const kitsToSync = [];
    if (repoSource) {
        kitsToSync.push(repoSource);
    } else if (options.all) {
        kitsToSync.push('github:anthonylee991/gemini-superpowers');
        kitsToSync.push('github:sickn33/antigravity-awesome-skills');
        kitsToSync.push('github:Academico-JZ/ag-jz-personal-kit');
    } else {
        console.error(chalk.red('Error: Please specify a repository source or use --all'));
        process.exit(1);
    }

    for (const source of kitsToSync) {
        const spinner = ora(`Downloading ${source}...`).start();
        try {
            const tmpDir = path.join(os.tmpdir(), `ag-jz-sync-${Date.now()}`);
            await giget(source, { dir: tmpDir, force: true });
            
            spinner.text = `Merging ${source} into ${targetDir}...`;
            mergeAgentFolder(tmpDir, targetDir, source);
            
            spinner.succeed(`Successfully synced kit: ${chalk.cyan(source)}`);
        } catch (error) {
            spinner.fail(`Failed to sync ${source}: ${error.message}`);
        }
    }

    // ENFORCE GOLDEN RULES after sync
    const spinner = ora('Enforcing Golden Rules (GEMINI.md)...').start();
    enforceGoldenRules(targetDir, true);
    spinner.succeed('Golden Rules enforced.');

    // NATIVE INDEXING
    const indexSpinner = ora('Generating skills index...').start();
    generateSkillsIndex(targetDir, true);
    indexSpinner.succeed('Skills index generated.');

    console.log(chalk.green(`\nSync complete! ${localMode ? '(Local Mode)' : '(Global Mode)'}`));
    console.log(chalk.gray(`Target: ${targetDir}\n`));
};

const linkCommand = async (options) => {
    const workspaceDir = process.cwd();
    const destAgent = path.join(workspaceDir, AGENT_FOLDER);
    const sourceAgent = DEFAULT_STORE;

    if (!fs.existsSync(sourceAgent)) {
        console.error(chalk.red('Error: Global .agent directory not found. Please run "ag-jz sync --all" first.'));
        process.exit(1);
    }

    const spinner = ora(`Linking global agent to ${workspaceDir}...`).start();

    try {
        // Enforce rules on global BEFORE linking
        enforceGoldenRules(sourceAgent, true);

        if (fs.existsSync(destAgent)) {
            const stats = fs.lstatSync(destAgent);
            if (stats.isSymbolicLink()) {
                fs.unlinkSync(destAgent);
            } else {
                spinner.fail(chalk.red(`Error: A physical ${AGENT_FOLDER} folder already exists. Please remove it first or use --local sync.`));
                process.exit(1);
            }
        }

        // Create junction on Windows, symlink on others
        const type = os.platform() === 'win32' ? 'junction' : 'dir';
        fs.symlinkSync(sourceAgent, destAgent, type);
        
        spinner.succeed(chalk.green(`Linked global agent to workspace: ${chalk.cyan(destAgent)}`));
    } catch (error) {
        spinner.fail(chalk.red(`Failed to create link: ${error.message}`));
    }
};

const statusCommand = () => {
    if (!fs.existsSync(DEFAULT_STORE)) {
        console.log(chalk.yellow('Antigravity is not initialized. Run "ag-jz sync --all" to start.'));
        return;
    }

    const registry = loadRegistry(DEFAULT_STORE);
    console.log(chalk.bold.blue('\n--- Antigravity Status ---'));
    console.log(`Global Store: ${chalk.cyan(DEFAULT_STORE)}`);
    console.log(`Kits Synced: ${Object.keys(registry.kits).length}`);
    
    Object.entries(registry.kits).forEach(([id, info]) => {
        console.log(`\n📦 ${chalk.bold(id)}`);
        console.log(`   Source: ${info.source}`);
        console.log(`   Files:  ${info.files.length}`);
        console.log(`   Updated: ${new Date(info.lastUpdated).toLocaleString()}`);
    });
    console.log('');
};

const enforceCommand = () => {
    const localAgent = path.join(process.cwd(), AGENT_FOLDER);
    const target = fs.existsSync(localAgent) ? localAgent : DEFAULT_STORE;
    
    const spinner = ora(`Enforcing Golden Rules on ${target}...`).start();
    enforceGoldenRules(target, true);
    spinner.succeed('Enforcement complete.');
};

// CLI DEF
program
    .name('ag-jz')
    .description('Antigravity Unified CLI manager for kits and rules')
    .version('1.0.0');

program.command('sync')
    .description('Sync Antigravity kits from GitHub to global or local storage')
    .argument('[source]', 'Repository source (e.g. github:user/repo)')
    .option('--all', 'Sync all default kits')
    .option('--local', 'Sync into current directory .agent instead of global')
    .action(syncCommand);

program.command('link')
    .description('Create a symbolic link from global agent to current workspace')
    .action(linkCommand);

program.command('status')
    .description('Show information about synced kits and global storage')
    .action(statusCommand);

program.command('enforce')
    .description('Force apply the master GEMINI.md rules to the current workspace or global store')
    .action(enforceCommand);

program.parse();
