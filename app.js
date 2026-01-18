const { useState, useEffect, useRef } = React;
const { createRoot } = ReactDOM;

// ==================== SISTEMA DE CACHE ====================
const CACHE_PREFIX = 'codemap_';
const CACHE_TTL = 24 * 60 * 60 * 1000;

const cache = {
    set: (key, data, ttl = CACHE_TTL) => {
        try {
            const item = {
                data,
                expiry: Date.now() + ttl,
                timestamp: Date.now()
            };
            localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(item));
            return true;
        } catch (err) {
            console.error('Erro ao salvar cache:', err);
            return false;
        }
    },
    
    get: (key) => {
        try {
            const itemStr = localStorage.getItem(CACHE_PREFIX + key);
            if (!itemStr) return null;
            
            const item = JSON.parse(itemStr);
            if (Date.now() > item.expiry) {
                localStorage.removeItem(CACHE_PREFIX + key);
                return null;
            }
            
            return item.data;
        } catch (err) {
            console.error('Erro ao ler cache:', err);
            return null;
        }
    },
    
    remove: (key) => {
        localStorage.removeItem(CACHE_PREFIX + key);
    },
    
    clear: () => {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (key.startsWith(CACHE_PREFIX)) {
                localStorage.removeItem(key);
            }
        });
    },
    
    getStats: () => {
        const keys = Object.keys(localStorage);
        const cacheKeys = keys.filter(key => key.startsWith(CACHE_PREFIX));
        const stats = {
            total: cacheKeys.length,
            size: 0,
            repos: []
        };
        
        cacheKeys.forEach(key => {
            try {
                const item = JSON.parse(localStorage.getItem(key));
                stats.size += JSON.stringify(item).length;
                if (item.data && item.data.repoInfo) {
                    stats.repos.push({
                        name: item.data.repoInfo.name,
                        owner: item.data.repoInfo.owner,
                        files: item.data.files ? item.data.files.length : 0,
                        timestamp: item.timestamp
                    });
                }
            } catch (e) {}
        });
        
        stats.sizeKB = Math.round(stats.size / 1024 * 100) / 100;
        return stats;
    }
};

// ==================== ANÁLISE DE IMPORTS PROFUNDA ====================
const analyzeImports = async (files, owner, repo, branch) => {
    console.log('Iniciando análise profunda de imports...');
    
    const importsData = {
        nodes: [],
        edges: [],
        fileContents: {},
        stats: {
            totalFiles: files.length,
            analyzedFiles: 0,
            totalImports: 0,
            internalImports: 0,
            externalImports: 0
        }
    };
    
    // Primeiro, criar nós para todos os arquivos
    const fileMap = new Map();
    files.forEach(file => {
        const node = {
            id: file.path,
            name: file.path.split('/').pop(),
            path: file.path,
            type: 'file',
            extension: file.extension,
            language: getFileLanguage(file.path),
            imports: [],
            importedBy: [],
            depth: file.path.split('/').length - 1,
            isRoot: file.path.split('/').length === 1,
            folderPath: file.path.substring(0, file.path.lastIndexOf('/')) || '/',
            size: file.sizeKB || 0
        };
        importsData.nodes.push(node);
        fileMap.set(file.path, node);
    });
    
    // Analisar conteúdo dos arquivos para extrair imports
    for (const node of importsData.nodes.slice(0, 50)) { // Limitar análise
        try {
            const contentRes = await fetch(
                `https://api.github.com/repos/${owner}/${repo}/contents/${node.path}?ref=${branch}`,
                { 
                    headers: { 
                        'Accept': 'application/vnd.github.v3.raw'
                    }
                }
            );
            
            if (!contentRes.ok) continue;
            
            const content = await contentRes.text();
            importsData.fileContents[node.path] = content;
            importsData.stats.analyzedFiles++;
            
            // Extrair imports mais precisamente
            const imports = extractImportsFromContent(content, node.path);
            importsData.stats.totalImports += imports.length;
            
            node.imports = imports;
            
            // Processar cada import encontrado
            imports.forEach(importPath => {
                const resolvedPath = resolveImportPath(importPath, node.path, Array.from(fileMap.values()));
                
                if (resolvedPath && fileMap.has(resolvedPath)) {
                    const targetNode = fileMap.get(resolvedPath);
                    
                    // Criar conexão
                    importsData.edges.push({
                        source: node.id,
                        target: targetNode.id,
                        id: `${node.id}->${targetNode.id}`,
                        type: 'import',
                        importPath: importPath
                    });
                    
                    // Adicionar relação importedBy
                    if (!targetNode.importedBy.includes(node.id)) {
                        targetNode.importedBy.push(node.id);
                    }
                    
                    importsData.stats.internalImports++;
                } else {
                    importsData.stats.externalImports++;
                }
            });
            
        } catch (err) {
            console.warn(`Erro ao analisar ${node.path}:`, err);
        }
    }
    
    console.log('Análise completa:', importsData.stats);
    return importsData;
};

const extractImportsFromContent = (content, filePath) => {
    const imports = [];
    
    // Padrões de import para diferentes linguagens
    const patterns = {
        javascript: [
            /from\s+['"](.+?)['"]/g,                    // ES6 import
            /require\s*\(\s*['"](.+?)['"]\s*\)/g,        // CommonJS require
            /import\s+['"](.+?)['"]/g,                   // ES6 import side-effect
            /import\s*\(\s*['"](.+?)['"]\s*\)/g,         // Dynamic import
            /export\s+.*from\s+['"](.+?)['"]/g          // Re-export
        ],
        typescript: [
            /from\s+['"](.+?)['"]/g,
            /require\s*\(\s*['"](.+?)['"]\s*\)/g,
            /import\s+['"](.+?)['"]/g,
            /import\s*\(\s*['"](.+?)['"]\s*\)/g,
            /export\s+.*from\s+['"](.+?)['"]/g,
            /<reference\s+path=['"](.+?)['"]\s*\/>/g     // TypeScript reference
        ],
        css: [
            /@import\s+['"](.+?)['"]/g,                  // CSS import
            /url\s*\(\s*['"]?(.+?)['"]?\s*\)/g           // CSS url
        ]
    };
    
    const ext = filePath.split('.').pop().toLowerCase();
    let relevantPatterns = [];
    
    if (['js', 'jsx'].includes(ext)) {
        relevantPatterns = patterns.javascript;
    } else if (['ts', 'tsx'].includes(ext)) {
        relevantPatterns = patterns.typescript;
    } else if (['css', 'scss', 'less'].includes(ext)) {
        relevantPatterns = patterns.css;
    } else {
        relevantPatterns = [...patterns.javascript, ...patterns.typescript];
    }
    
    // Extrair imports
    relevantPatterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(content)) !== null) {
            const importPath = match[1];
            if (importPath && !importPath.startsWith('http')) {
                imports.push(importPath);
            }
        }
    });
    
    return imports;
};

const resolveImportPath = (importPath, sourcePath, allNodes) => {
    // Normalizar caminhos
    const sourceDir = sourcePath.substring(0, sourcePath.lastIndexOf('/')) || '';
    const normalizedImport = importPath
        .replace(/^\.\//, '')
        .replace(/^\.\.\//, '');
    
    // Casos de resolução
    const resolveCases = [];
    
    // Caso 1: Import relativo (./ ou ../)
    if (importPath.startsWith('.')) {
        // Calcular caminho absoluto
        const parts = sourceDir.split('/').filter(p => p);
        const importParts = importPath.split('/').filter(p => p);
        
        for (const part of importParts) {
            if (part === '..') {
                parts.pop();
            } else if (part !== '.') {
                parts.push(part);
            }
        }
        
        const absolutePath = parts.join('/');
        
        // Tentar com extensões comuns
        resolveCases.push(
            absolutePath,
            `${absolutePath}.js`,
            `${absolutePath}.ts`,
            `${absolutePath}.jsx`,
            `${absolutePath}.tsx`,
            `${absolutePath}/index.js`,
            `${absolutePath}/index.ts`,
            `${absolutePath}/index.jsx`,
            `${absolutePath}/index.tsx`
        );
    }
    // Caso 2: Import de módulo (provavelmente externo)
    else if (!importPath.startsWith('/') && !importPath.startsWith('.')) {
        // Verificar se é um arquivo local referenciado como módulo
        const possiblePaths = [
            `node_modules/${importPath}`,
            `src/${importPath}`,
            `lib/${importPath}`,
            `components/${importPath}`,
            `utils/${importPath}`
        ];
        
        possiblePaths.forEach(base => {
            resolveCases.push(
                base,
                `${base}.js`,
                `${base}.ts`,
                `${base}/index.js`,
                `${base}/index.ts`
            );
        });
    }
    // Caso 3: Import absoluto (/)
    else {
        const absPath = importPath.startsWith('/') ? importPath.slice(1) : importPath;
        resolveCases.push(
            absPath,
            `${absPath}.js`,
            `${absPath}.ts`,
            `${absPath}.jsx`,
            `${absPath}.tsx`
        );
    }
    
    // Procurar correspondência
    for (const path of resolveCases) {
        const exactMatch = allNodes.find(n => n.path === path);
        if (exactMatch) return exactMatch.path;
        
        // Procurar correspondência parcial (sem extensão)
        const partialMatch = allNodes.find(n => 
            n.path.replace(/\.[^/.]+$/, "") === path.replace(/\.[^/.]+$/, "")
        );
        if (partialMatch) return partialMatch.path;
    }
    
    return null;
};

const getFileLanguage = (path) => {
    const ext = path.split('.').pop().toLowerCase();
    const languages = {
        'js': 'JavaScript',
        'jsx': 'JavaScript (React)',
        'ts': 'TypeScript',
        'tsx': 'TypeScript (React)',
        'css': 'CSS',
        'scss': 'SCSS',
        'less': 'LESS',
        'json': 'JSON',
        'md': 'Markdown',
        'html': 'HTML',
        'vue': 'Vue.js',
        'svelte': 'Svelte'
    };
    return languages[ext] || ext.toUpperCase();
};

// ==================== ÁRVORE DE DEPENDÊNCIAS INTERATIVA ====================
const DependencyTree = ({ importsData, onNodeClick, repoBase }) => {
    const containerRef = useRef(null);
    const [selectedNode, setSelectedNode] = useState(null);
    const [zoom, setZoom] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    
    // Construir hierarquia de pastas
    const buildFolderHierarchy = () => {
        const root = {
            id: 'root',
            name: 'Repositório',
            type: 'folder',
            children: [],
            path: '',
            depth: 0
        };
        
        const folderMap = new Map();
        folderMap.set('', root);
        
        // Organizar arquivos por pasta
        importsData.nodes.forEach(node => {
            const folderPath = node.folderPath;
            
            // Criar pastas intermediárias se não existirem
            const parts = folderPath === '/' ? [] : folderPath.split('/').filter(p => p);
            let currentPath = '';
            
            for (let i = 0; i < parts.length; i++) {
                const subPath = parts.slice(0, i + 1).join('/');
                if (!folderMap.has(subPath)) {
                    const folder = {
                        id: `folder_${subPath}`,
                        name: parts[i],
                        type: 'folder',
                        children: [],
                        path: subPath,
                        depth: i + 1,
                        files: []
                    };
                    folderMap.set(subPath, folder);
                    
                    const parentPath = parts.slice(0, i).join('/') || '';
                    folderMap.get(parentPath).children.push(folder);
                }
                currentPath = subPath;
            }
            
            // Adicionar arquivo à pasta
            const parentFolder = folderMap.get(folderPath);
            if (parentFolder) {
                parentFolder.children.push(node);
            }
        });
        
        return root;
    };
    
    // Renderizar árvore
    useEffect(() => {
        if (!containerRef.current || !importsData || importsData.nodes.length === 0) return;
        
        const container = containerRef.current;
        container.innerHTML = '';
        
        const hierarchy = buildFolderHierarchy();
        const width = container.clientWidth;
        const height = container.clientHeight;
        
        // Criar SVG
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        svg.style.cursor = isDragging ? 'grabbing' : 'grab';
        
        // Grupo para zoom/pan
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('transform', `translate(${offset.x}, ${offset.y}) scale(${zoom})`);
        
        // Calcular posições
        const positions = calculateTreePositions(hierarchy, width, height);
        
        // Desenhar conexões (edges)
        importsData.edges.forEach(edge => {
            const sourcePos = positions.get(edge.source);
            const targetPos = positions.get(edge.target);
            
            if (sourcePos && targetPos) {
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', `M ${sourcePos.x} ${sourcePos.y} L ${targetPos.x} ${targetPos.y}`);
                path.setAttribute('stroke', '#3b82f6');
                path.setAttribute('stroke-width', '1.5');
                path.setAttribute('fill', 'none');
                path.setAttribute('opacity', '0.4');
                path.setAttribute('marker-end', 'url(#arrowhead)');
                g.appendChild(path);
            }
        });
        
        // Desenhar nós
        positions.forEach((pos, id) => {
            const node = importsData.nodes.find(n => n.id === id) || 
                        { id, name: id.replace('folder_', '').split('/').pop(), type: 'folder' };
            
            const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            group.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
            
            // Círculo para nó
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('r', node.type === 'folder' ? '20' : '15');
            circle.setAttribute('fill', getNodeColor(node));
            circle.setAttribute('stroke', selectedNode === node.id ? '#f59e0b' : '#475569');
            circle.setAttribute('stroke-width', selectedNode === node.id ? '3' : '2');
            circle.style.cursor = 'pointer';
            circle.addEventListener('click', () => {
                setSelectedNode(node.id);
                if (onNodeClick) onNodeClick(node);
            });
            
            // Ícone
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'central');
            text.setAttribute('fill', 'white');
            text.setAttribute('font-size', node.type === 'folder' ? '12' : '10');
            text.setAttribute('font-weight', 'bold');
            text.textContent = node.type === 'folder' ? '📁' : getFileIcon(node.extension);
            
            // Tooltip
            const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            title.textContent = `${node.name}\n${node.path}\nImporta: ${node.imports?.length || 0} arquivos\nImportado por: ${node.importedBy?.length || 0} arquivos`;
            
            group.appendChild(circle);
            group.appendChild(text);
            group.appendChild(title);
            g.appendChild(group);
            
            // Label
            const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            label.setAttribute('x', pos.x);
            label.setAttribute('y', pos.y + (node.type === 'folder' ? 30 : 25));
            label.setAttribute('text-anchor', 'middle');
            label.setAttribute('fill', '#cbd5e1');
            label.setAttribute('font-size', '10');
            label.setAttribute('font-family', 'monospace');
            label.textContent = node.name.length > 15 ? node.name.substring(0, 12) + '...' : node.name;
            g.appendChild(label);
        });
        
        // Definir arrowhead marker
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        marker.setAttribute('id', 'arrowhead');
        marker.setAttribute('markerWidth', '10');
        marker.setAttribute('markerHeight', '7');
        marker.setAttribute('refX', '9');
        marker.setAttribute('refY', '3.5');
        marker.setAttribute('orient', 'auto');
        
        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        polygon.setAttribute('points', '0 0, 10 3.5, 0 7');
        polygon.setAttribute('fill', '#3b82f6');
        
        marker.appendChild(polygon);
        defs.appendChild(marker);
        
        svg.appendChild(defs);
        svg.appendChild(g);
        container.appendChild(svg);
        
        // Event listeners para zoom/pan
        const handleWheel = (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            setZoom(prev => Math.max(0.5, Math.min(3, prev * delta)));
        };
        
        const handleMouseDown = (e) => {
            if (e.button === 0) {
                setIsDragging(true);
                setDragStart({
                    x: e.clientX - offset.x,
                    y: e.clientY - offset.y
                });
            }
        };
        
        const handleMouseMove = (e) => {
            if (!isDragging) return;
            setOffset({
                x: e.clientX - dragStart.x,
                y: e.clientY - dragStart.y
            });
        };
        
        const handleMouseUp = () => {
            setIsDragging(false);
        };
        
        svg.addEventListener('wheel', handleWheel);
        svg.addEventListener('mousedown', handleMouseDown);
        svg.addEventListener('mousemove', handleMouseMove);
        svg.addEventListener('mouseup', handleMouseUp);
        svg.addEventListener('mouseleave', handleMouseUp);
        
        return () => {
            svg.removeEventListener('wheel', handleWheel);
            svg.removeEventListener('mousedown', handleMouseDown);
            svg.removeEventListener('mousemove', handleMouseMove);
            svg.removeEventListener('mouseup', handleMouseUp);
            svg.removeEventListener('mouseleave', handleMouseUp);
        };
        
    }, [importsData, selectedNode, zoom, offset, isDragging, onNodeClick]);
    
    const calculateTreePositions = (hierarchy, width, height) => {
        const positions = new Map();
        const nodeWidth = 150;
        const nodeHeight = 80;
        const verticalSpacing = 100;
        const horizontalSpacing = 200;
        
        const traverse = (node, x, y, level) => {
            positions.set(node.id, { x, y });
            
            if (node.children && node.children.length > 0) {
                const childCount = node.children.length;
                const startX = x - ((childCount - 1) * horizontalSpacing) / 2;
                
                node.children.forEach((child, index) => {
                    const childX = startX + (index * horizontalSpacing);
                    const childY = y + verticalSpacing;
                    traverse(child, childX, childY, level + 1);
                });
            }
        };
        
        traverse(hierarchy, width / 2, 100, 0);
        return positions;
    };
    
    const getNodeColor = (node) => {
        if (node.type === 'folder') return '#1e293b';
        
        const colors = {
            'js': '#3b82f6', 'jsx': '#06b6d4',
            'ts': '#1d4ed8', 'tsx': '#1e40af',
            'css': '#8b5cf6', 'scss': '#7c3aed',
            'json': '#f59e0b',
            'md': '#10b981',
            'html': '#ef4444',
            'vue': '#42b883',
            'svelte': '#ff3e00'
        };
        return colors[node.extension] || '#6b7280';
    };
    
    const getFileIcon = (extension) => {
        const icons = {
            'js': 'JS', 'jsx': 'JSX',
            'ts': 'TS', 'tsx': 'TSX',
            'css': 'CSS', 'scss': 'SCSS',
            'json': '{}', 'md': 'MD',
            'html': '</>', 'vue': 'VUE',
            'svelte': 'SVL'
        };
        return icons[extension] || '📄';
    };
    
    // Controles de zoom
    const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.1, 3));
    const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.1, 0.5));
    const handleResetView = () => {
        setZoom(1);
        setOffset({ x: 0, y: 0 });
    };
    
    return React.createElement('div', { 
        style: { width: '100%', height: '100%', position: 'relative' }
    }, [
        // Controles
        React.createElement('div', {
            key: 'controls',
            style: {
                position: 'absolute',
                top: '10px',
                right: '10px',
                zIndex: 10,
                display: 'flex',
                gap: '5px'
            }
        }, [
            React.createElement('button', {
                key: 'zoom-in',
                onClick: handleZoomIn,
                style: {
                    padding: '8px 12px',
                    background: '#1e293b',
                    color: '#cbd5e1',
                    border: '1px solid #475569',
                    borderRadius: '4px',
                    cursor: 'pointer'
                }
            }, '+'),
            React.createElement('button', {
                key: 'zoom-out',
                onClick: handleZoomOut,
                style: {
                    padding: '8px 12px',
                    background: '#1e293b',
                    color: '#cbd5e1',
                    border: '1px solid #475569',
                    borderRadius: '4px',
                    cursor: 'pointer'
                }
            }, '−'),
            React.createElement('button', {
                key: 'reset',
                onClick: handleResetView,
                style: {
                    padding: '8px 12px',
                    background: '#1e293b',
                    color: '#cbd5e1',
                    border: '1px solid #475569',
                    borderRadius: '4px',
                    cursor: 'pointer'
                }
            }, '⟲')
        ]),
        
        // Container do gráfico
        React.createElement('div', {
            key: 'graph-container',
            ref: containerRef,
            style: {
                width: '100%',
                height: '100%',
                background: '#0f172a',
                borderRadius: '8px',
                overflow: 'hidden'
            }
        }),
        
        // Legenda
        React.createElement('div', {
            key: 'legend',
            style: {
                position: 'absolute',
                bottom: '20px',
                left: '20px',
                background: 'rgba(15, 23, 42, 0.9)',
                padding: '10px',
                borderRadius: '6px',
                border: '1px solid rgba(255,255,255,0.1)',
                fontSize: '11px',
                color: '#cbd5e1'
            }
        }, [
            React.createElement('div', {
                key: 'title',
                style: { fontWeight: 'bold', marginBottom: '8px' }
            }, 'Legenda:'),
            React.createElement('div', {
                key: 'folder',
                style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }
            }, [
                React.createElement('div', {
                    style: { width: '12px', height: '12px', background: '#1e293b', borderRadius: '50%', border: '1px solid #475569' }
                }),
                React.createElement('span', null, 'Pasta')
            ]),
            React.createElement('div', {
                key: 'js',
                style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }
            }, [
                React.createElement('div', {
                    style: { width: '12px', height: '12px', background: '#3b82f6', borderRadius: '50%' }
                }),
                React.createElement('span', null, 'Arquivo JavaScript')
            ]),
            React.createElement('div', {
                key: 'ts',
                style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }
            }, [
                React.createElement('div', {
                    style: { width: '12px', height: '12px', background: '#1d4ed8', borderRadius: '50%' }
                }),
                React.createElement('span', null, 'Arquivo TypeScript')
            ]),
            React.createElement('div', {
                key: 'connection',
                style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }
            }, [
                React.createElement('div', {
                    style: { width: '20px', height: '2px', background: '#3b82f6' }
                }),
                React.createElement('span', null, 'Dependência (import)')
            ])
        ])
    ]);
};

// ==================== COMPONENTE PRINCIPAL APP ====================
function App() {
    const [url, setUrl] = useState('');
    const [files, setFiles] = useState([]);
    const [fileTree, setFileTree] = useState(null);
    const [status, setStatus] = useState('Pronto para analisar');
    const [repoBase, setRepoBase] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [repoInfo, setRepoInfo] = useState(null);
    const [lastUrl, setLastUrl] = useState('');
    
    // Estados para análise de imports
    const [importsData, setImportsData] = useState(null);
    const [analyzingImports, setAnalyzingImports] = useState(false);
    const [activeView, setActiveView] = useState('tree'); // 'tree', 'imports', 'graph'
    const [selectedFile, setSelectedFile] = useState(null);
    const [cacheStats, setCacheStats] = useState(() => cache.getStats());
    
    const analyzeGithub = async (githubUrl = null, forceRefresh = false) => {
        const urlToAnalyze = githubUrl || url;
        if (!urlToAnalyze) {
            setError('Por favor, insira uma URL do GitHub');
            return;
        }
        
        const match = urlToAnalyze.match(/github\.com\/([^/]+)\/([^/]+)/);
        if (!match) {
            setError('URL do GitHub inválida. Formato: https://github.com/usuario/repositorio');
            return;
        }
        
        const [_, owner, repo] = match;
        const currentRepo = `${owner}/${repo}`;
        
        const cacheKey = `repo_${currentRepo.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const cachedData = cache.get(cacheKey);
        
        if (!forceRefresh && cachedData) {
            setStatus('📦 Carregando do cache...');
            setTimeout(() => {
                setFiles(cachedData.files);
                setRepoInfo(cachedData.repoInfo);
                setRepoBase(cachedData.repoBase);
                setLastUrl(currentRepo);
                setImportsData(null);
                setStatus(`✅ ${cachedData.files.length} arquivos (do cache)`);
                showNotification('Dados carregados do cache!', 'success');
            }, 100);
            return;
        }
        
        setLoading(true);
        setStatus('🔍 Conectando ao GitHub...');
        setError(null);
        setLastUrl(currentRepo);
        setImportsData(null);
        setActiveView('tree');
        
        try {
            const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
                headers: { 'Accept': 'application/vnd.github.v3+json' }
            });
            
            if (!repoRes.ok) {
                if (repoRes.status === 404) {
                    throw new Error('Repositório não encontrado');
                }
                throw new Error(`Erro ${repoRes.status}: ${repoRes.statusText}`);
            }
            
            const repoData = await repoRes.json();
            setRepoInfo({
                name: repoData.name,
                description: repoData.description,
                stars: repoData.stargazers_count,
                forks: repoData.forks_count,
                language: repoData.language,
                owner: repoData.owner.login,
                default_branch: repoData.default_branch
            });
            
            const branch = repoData.default_branch || 'main';
            const apiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
            
            console.log('Buscando dados da API:', apiUrl);
            
            const res = await fetch(apiUrl, {
                headers: { 'Accept': 'application/vnd.github.v3+json' }
            });
            
            if (!res.ok) {
                if (res.status === 404) {
                    throw new Error('Branch principal não encontrada');
                } else if (res.status === 403) {
                    throw new Error('Limite de requisições excedido. Aguarde alguns minutos.');
                }
                throw new Error(`Erro ${res.status}: ${res.statusText}`);
            }
            
            const data = await res.json();
            
            if (!data.tree) {
                throw new Error('Estrutura do repositório não encontrada');
            }
            
            const fileList = data.tree
                .filter(f => f.type === 'blob')
                .map(f => ({
                    ...f,
                    path: f.path,
                    extension: f.path.split('.').pop().toLowerCase(),
                    sizeKB: Math.round((f.size || 1024) / 1024 * 10) / 10,
                    language: getFileLanguage(f.path)
                }))
                .filter(f => {
                    const path = f.path.toLowerCase();
                    return !path.includes('node_modules') && 
                           !path.includes('dist') && 
                           !path.includes('build') &&
                           !path.includes('.git') &&
                           !path.startsWith('.');
                });
            
            if (fileList.length === 0) {
                setError('Nenhum arquivo encontrado no repositório');
                setFiles([]);
                setFileTree(null);
                setStatus('⚠️ Repositório vazio ou sem arquivos visíveis');
                setLoading(false);
                return;
            }
            
            const repoBaseUrl = `https://github.com/${owner}/${repo}`;
            setRepoBase(repoBaseUrl);
            setFiles(fileList);
            
            // Salvar no cache
            const cacheData = {
                files: fileList,
                repoInfo: {
                    name: repoData.name,
                    description: repoData.description,
                    stars: repoData.stargazers_count,
                    forks: repoData.forks_count,
                    language: repoData.language,
                    owner: repoData.owner.login,
                    default_branch: repoData.default_branch
                },
                repoBase: repoBaseUrl,
                timestamp: Date.now()
            };
            
            if (cache.set(cacheKey, cacheData)) {
                setCacheStats(cache.getStats());
                showNotification('Análise salva no cache!', 'success');
            }
            
            setStatus(`✅ ${fileList.length} arquivos carregados! Clique em "Analisar Imports"`);
            setLoading(false);
            
        } catch (err) {
            console.error('Erro:', err);
            setError(err.message);
            setStatus('❌ Erro na conexão');
            setFiles([]);
            setFileTree(null);
            setLoading(false);
        }
    };
    
    const analyzeImportsForRepo = async () => {
        if (!repoInfo || files.length === 0) return;
        
        setAnalyzingImports(true);
        setStatus('🔍 Analisando imports nos arquivos...');
        
        try {
            const [owner, repo] = lastUrl.split('/');
            const branch = repoInfo.default_branch || 'main';
            
            const imports = await analyzeImports(files, owner, repo, branch);
            setImportsData(imports);
            setActiveView('imports');
            setStatus(`✅ ${imports.stats.analyzedFiles} arquivos analisados, ${imports.stats.totalImports} imports encontrados`);
        } catch (err) {
            console.error('Erro na análise de imports:', err);
            setError('Erro ao analisar imports: ' + err.message);
            setStatus('❌ Falha na análise de imports');
        } finally {
            setAnalyzingImports(false);
        }
    };
    
    const showNotification = (message, type = 'info') => {
        // Implementação simplificada de notificação
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <div style="padding: 12px 16px; border-radius: 6px; background: ${
                type === 'success' ? '#10b981' : 
                type === 'error' ? '#ef4444' : '#3b82f6'
            }; color: white; margin-bottom: 10px;">
                ${message}
            </div>
        `;
        
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 3000);
    };
    
    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !loading) {
            analyzeGithub();
        }
    };
    
    const handleNodeClick = (node) => {
        setSelectedFile(node);
        if (repoBase && node.type === 'file') {
            window.open(`${repoBase}/blob/main/${node.path}`, '_blank');
        }
    };
    
    const handleClearCache = () => {
        if (confirm('Tem certeza que deseja limpar todo o cache?')) {
            cache.clear();
            setCacheStats(cache.getStats());
            showNotification('Cache limpo com sucesso!', 'success');
        }
    };
    
    const examples = [
        { name: 'React', url: 'https://github.com/facebook/react' },
        { name: 'Vue.js', url: 'https://github.com/vuejs/vue' },
        { name: 'VS Code', url: 'https://github.com/microsoft/vscode' },
        { name: 'Next.js', url: 'https://github.com/vercel/next.js' }
    ];
    
    return React.createElement('div', { 
        style: { width: '100%', height: '100%', position: 'relative' } 
    }, [
        // UI Layer
        React.createElement('div', { 
            key: 'ui-layer',
            className: 'ui-layer'
        }, [
            React.createElement('div', { 
                key: 'header',
                style: { marginBottom: '15px' }
            }, [
                React.createElement('h3', { 
                    key: 'title',
                    style: { margin: '0 0 10px 0', color: '#f8fafc' }
                }, 'Code Dependency Tree'),
                React.createElement('p', { 
                    key: 'subtitle',
                    style: { fontSize: '12px', color: '#94a3b8', margin: '0' }
                }, 'Visualize as conexões entre arquivos baseadas em imports')
            ]),
            
            // View Toggle
            files.length > 0 && React.createElement('div', {
                key: 'view-toggle',
                className: 'view-toggle'
            }, [
                React.createElement('button', {
                    key: 'tree-view',
                    className: activeView === 'tree' ? 'active' : '',
                    onClick: () => setActiveView('tree')
                }, '📁 Lista de Arquivos'),
                React.createElement('button', {
                    key: 'imports-view',
                    className: activeView === 'imports' ? 'active' : '',
                    onClick: () => {
                        if (!importsData && !analyzingImports) {
                            analyzeImportsForRepo();
                        } else {
                            setActiveView('imports');
                        }
                    },
                    disabled: analyzingImports
                }, analyzingImports ? '🔍 Analisando...' : '🔗 Árvore de Imports')
            ]),
            
            React.createElement('div', { 
                key: 'input-group',
                className: 'input-group'
            }, [
                React.createElement('input', { 
                    key: 'input',
                    placeholder: 'https://github.com/usuario/projeto',
                    value: url,
                    onChange: e => setUrl(e.target.value),
                    onKeyPress: handleKeyPress,
                    disabled: loading || analyzingImports
                }),
                React.createElement('button', { 
                    key: 'button',
                    onClick: () => analyzeGithub(),
                    disabled: loading || analyzingImports
                }, loading ? [
                    React.createElement('span', { key: 'spinner', className: 'loading-spinner' }),
                    'ANALISANDO...'
                ] : [
                    React.createElement('i', { key: 'icon', className: 'fas fa-rocket' }),
                    ' ANALISAR'
                ])
            ]),
            
            React.createElement('div', { 
                key: 'status-box',
                className: `status-box ${error ? 'error' : ''}`
            }, [
                React.createElement('strong', { key: 'label' }, 'Status: '),
                status,
                error && React.createElement('div', { 
                    key: 'error',
                    style: { marginTop: '8px', fontSize: '13px' }
                }, error)
            ]),
            
            // Controles de Cache
            React.createElement('div', {
                key: 'cache-controls',
                className: 'cache-controls'
            }, [
                React.createElement('button', {
                    key: 'load-cache',
                    onClick: () => analyzeGithub(null, false),
                    disabled: !lastUrl,
                    title: 'Carregar do cache'
                }, [
                    React.createElement('i', { key: 'icon', className: 'fas fa-database' }),
                    ' Carregar do Cache'
                ]),
                React.createElement('button', {
                    key: 'clear-cache',
                    onClick: handleClearCache,
                    title: 'Limpar cache'
                }, [
                    React.createElement('i', { key: 'icon', className: 'fas fa-trash-alt' }),
                    ' Limpar Cache'
                ])
            ]),
            
            // Informações do Repositório
            repoInfo && React.createElement('div', {
                key: 'repo-info',
                className: 'file-stats'
            }, [
                React.createElement('div', {
                    key: 'name',
                    style: { fontWeight: 'bold', marginBottom: '5px' }
                }, `${repoInfo.owner}/${repoInfo.name}`),
                repoInfo.description && React.createElement('div', {
                    key: 'desc',
                    style: { fontSize: '11px', marginBottom: '5px', color: '#cbd5e1' }
                }, repoInfo.description),
                React.createElement('div', {
                    key: 'stats',
                    className: 'stats-grid'
                }, [
                    React.createElement('div', { key: 'lang', className: 'stat-item' }, [
                        React.createElement('span', { key: 'label' }, 'Linguagem:'),
                        React.createElement('span', { key: 'value', className: 'stat-value' }, repoInfo.language || 'Várias')
                    ]),
                    React.createElement('div', { key: 'stars', className: 'stat-item' }, [
                        React.createElement('span', { key: 'label' }, '⭐ Stars:'),
                        React.createElement('span', { key: 'value', className: 'stat-value' }, repoInfo.stars)
                    ]),
                    React.createElement('div', { key: 'forks', className: 'stat-item' }, [
                        React.createElement('span', { key: 'label' }, '🍴 Forks:'),
                        React.createElement('span', { key: 'value', className: 'stat-value' }, repoInfo.forks)
                    ]),
                    React.createElement('div', { key: 'files', className: 'stat-item' }, [
                        React.createElement('span', { key: 'label' }, '📁 Arquivos:'),
                        React.createElement('span', { key: 'value', className: 'stat-value' }, files.length)
                    ])
                ])
            ]),
            
            // Estatísticas de Imports (se disponível)
            importsData && React.createElement('div', {
                key: 'imports-stats',
                className: 'file-stats',
                style: { marginTop: '10px' }
            }, [
                React.createElement('div', {
                    key: 'title',
                    style: { fontWeight: 'bold', marginBottom: '5px' }
                }, '📊 Estatísticas de Imports'),
                React.createElement('div', {
                    key: 'stats',
                    className: 'stats-grid'
                }, [
                    React.createElement('div', { key: 'analyzed', className: 'stat-item' }, [
                        React.createElement('span', { key: 'label' }, 'Analisados:'),
                        React.createElement('span', { key: 'value', className: 'stat-value' }, importsData.stats.analyzedFiles)
                    ]),
                    React.createElement('div', { key: 'imports', className: 'stat-item' }, [
                        React.createElement('span', { key: 'label' }, 'Imports:'),
                        React.createElement('span', { key: 'value', className: 'stat-value' }, importsData.stats.totalImports)
                    ]),
                    React.createElement('div', { key: 'internal', className: 'stat-item' }, [
                        React.createElement('span', { key: 'label' }, 'Internos:'),
                        React.createElement('span', { key: 'value', className: 'stat-value' }, importsData.stats.internalImports)
                    ]),
                    React.createElement('div', { key: 'external', className: 'stat-item' }, [
                        React.createElement('span', { key: 'label' }, 'Externos:'),
                        React.createElement('span', { key: 'value', className: 'stat-value' }, importsData.stats.externalImports)
                    ])
                ])
            ]),
            
            // Exemplos
            files.length === 0 && React.createElement('div', {
                key: 'examples',
                style: { marginTop: '15px' }
            }, [
                React.createElement('p', {
                    key: 'label',
                    style: { fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }
                }, 'Experimente com:'),
                React.createElement('div', {
                    key: 'buttons',
                    style: { display: 'flex', flexWrap: 'wrap', gap: '6px' }
                }, examples.map((example, i) =>
                    React.createElement('button', {
                        key: `example-${i}`,
                        style: {
                            padding: '6px 10px',
                            background: 'rgba(30, 41, 59, 0.8)',
                            color: '#cbd5e1',
                            border: '1px solid #475569',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '11px',
                            transition: 'all 0.2s'
                        },
                        onMouseEnter: (e) => {
                            e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)';
                            e.currentTarget.style.borderColor = '#3b82f6';
                        },
                        onMouseLeave: (e) => {
                            e.currentTarget.style.background = 'rgba(30, 41, 59, 0.8)';
                            e.currentTarget.style.borderColor = '#475569';
                        },
                        onClick: () => {
                            setUrl(example.url);
                            setTimeout(() => analyzeGithub(example.url), 100);
                        }
                    }, example.name)
                ))
            ])
        ]),
        
        // Visualização de Arquivos (Lista)
        files.length > 0 && activeView === 'tree' && React.createElement('div', {
            key: 'files-container',
            className: 'tree-container',
            style: { padding: '80px 20px 20px 420px' }
        }, [
            React.createElement('div', {
                key: 'files-view',
                className: 'tree-view',
                style: { maxHeight: 'calc(100vh - 120px)', overflow: 'auto' }
            }, [
                React.createElement('div', {
                    key: 'controls',
                    className: 'tree-controls'
                }, [
                    React.createElement('button', {
                        key: 'analyze-btn',
                        onClick: analyzeImportsForRepo,
                        disabled: analyzingImports,
                        style: { background: '#3b82f6', color: 'white' }
                    }, analyzingImports ? '🔍 Analisando...' : '🔗 Analisar Imports'),
                    React.createElement('span', {
                        key: 'count',
                        style: { marginLeft: 'auto', color: '#94a3b8', fontSize: '12px' }
                    }, `${files.length} arquivos`)
                ]),
                
                React.createElement('div', {
                    key: 'files-list'
                }, files.map((file, index) => 
                    React.createElement('div', {
                        key: index,
                        style: {
                            padding: '10px',
                            margin: '5px 0',
                            background: 'rgba(30, 41, 59, 0.8)',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            border: selectedFile?.path === file.path ? '2px solid #3b82f6' : '1px solid transparent',
                            transition: 'all 0.2s'
                        },
                        onClick: () => handleNodeClick({
                            id: file.path,
                            name: file.path.split('/').pop(),
                            path: file.path,
                            type: 'file',
                            extension: file.extension
                        })
                    }, [
                        React.createElement('div', {
                            key: 'name',
                            style: { display: 'flex', alignItems: 'center', gap: '10px' }
                        }, [
                            React.createElement('span', {
                                key: 'icon',
                                style: { fontSize: '16px' }
                            }, getFileIcon(file.extension)),
                            React.createElement('span', {
                                key: 'text',
                                style: { fontFamily: 'monospace', fontSize: '13px' }
                            }, file.path)
                        ]),
                        React.createElement('div', {
                            key: 'details',
                            style: { fontSize: '11px', color: '#94a3b8', marginTop: '5px' }
                        }, [
                            React.createElement('span', { key: 'size' }, `${file.sizeKB} KB • `),
                            React.createElement('span', { key: 'lang' }, file.language)
                        ])
                    ])
                ))
            ])
        ]),
        
        // Árvore de Imports (Grafo)
        importsData && activeView === 'imports' && React.createElement('div', {
            key: 'imports-container',
            className: 'dependencies-container active',
            style: { padding: '80px 20px 20px 420px' }
        }, [
            React.createElement('div', {
                key: 'imports-view',
                style: { width: '100%', height: '100%' }
            }, [
                React.createElement(DependencyTree, {
                    key: 'dependency-tree',
                    importsData: importsData,
                    onNodeClick: handleNodeClick,
                    repoBase: repoBase
                })
            ])
        ]),
        
        // Tela inicial vazia
        files.length === 0 && React.createElement('div', {
            key: 'empty-state',
            style: {
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100%',
                color: '#94a3b8',
                textAlign: 'center'
            }
        }, [
            React.createElement('div', { key: 'content' }, [
                React.createElement('div', {
                    key: 'icon',
                    style: { fontSize: '60px', marginBottom: '20px' }
                }, '🌳'),
                React.createElement('h3', {
                    key: 'title',
                    style: { color: '#cbd5e1', marginBottom: '10px' }
                }, 'Code Dependency Tree'),
                React.createElement('p', {
                    key: 'subtitle',
                    style: { maxWidth: '500px', margin: '0 auto 20px' }
                }, 'Cole uma URL do GitHub para visualizar a estrutura de imports do código'),
                React.createElement('div', {
                    key: 'examples',
                    style: { marginTop: '30px' }
                }, [
                    React.createElement('p', {
                        key: 'label',
                        style: { fontSize: '14px', marginBottom: '10px' }
                    }, 'Experimente com:'),
                    React.createElement('div', {
                        key: 'buttons',
                        style: { display: 'flex', justifyContent: 'center', gap: '10px', flexWrap: 'wrap' }
                    }, examples.map((example, i) =>
                        React.createElement('button', {
                            key: `example-${i}`,
                            onClick: () => {
                                setUrl(example.url);
                                setTimeout(() => analyzeGithub(example.url), 100);
                            },
                            style: {
                                padding: '10px 20px',
                                background: 'rgba(30, 41, 59, 0.8)',
                                color: '#cbd5e1',
                                border: '1px solid #475569',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontSize: '13px',
                                transition: 'all 0.2s'
                            }
                        }, example.name)
                    ))
                ])
            ])
        ])
    ]);
}

// Inicializar aplicação
document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('app');
    if (container && React && ReactDOM) {
        try {
            const root = createRoot(container);
            root.render(React.createElement(App));
        } catch (error) {
            console.error('Erro ao renderizar aplicação:', error);
            container.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #dc2626;">
                    <h3>Erro ao carregar a aplicação</h3>
                    <p>${error.message}</p>
                    <button onclick="window.location.reload()" style="padding: 10px 20px; margin-top: 20px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer;">
                        Recarregar Página
                    </button>
                </div>
            `;
        }
    }
});