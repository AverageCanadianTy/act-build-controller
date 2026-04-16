import { useState } from 'react'

const FileTreeNode = ({ node, onToggle, ignorePatterns, depth = 0 }) => {
  const [isOpen, setIsOpen] = useState(depth === 0)
  const isIgnored = ignorePatterns.includes(node.path)

  if (node.isDirectory) {
    return (
      <div className={`tree-node${isIgnored ? ' is-ignored' : ''}`}>
        <div className="node-content" onClick={() => setIsOpen((o) => !o)}>
          <input
            type="checkbox"
            checked={isIgnored}
            onChange={(e) => { e.stopPropagation(); onToggle(node.path) }}
            onClick={(e) => e.stopPropagation()}
          />
          <span className="dir-arrow">{isOpen ? '▾' : '▸'}</span>
          <span className="folder-icon">📁</span>
          <span className="node-name">{node.name}</span>
        </div>
        {isOpen && node.children && node.children.length > 0 && (
          <div className="node-children">
            {node.children.map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                onToggle={onToggle}
                ignorePatterns={ignorePatterns}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={`tree-node${isIgnored ? ' is-ignored' : ''}`}>
      <div className="node-content">
        <input
          type="checkbox"
          checked={isIgnored}
          onChange={() => onToggle(node.path)}
        />
        <span className="file-icon">📄</span>
        <span className="node-name">{node.name}</span>
      </div>
    </div>
  )
}

export default function FileTree({ tree, onToggle, ignorePatterns }) {
  if (!tree || tree.length === 0) {
    return <div className="empty-tree">Scan a root folder to see files.</div>
  }

  return (
    <div className="file-tree-container">
      {tree.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          onToggle={onToggle}
          ignorePatterns={ignorePatterns}
          depth={0}
        />
      ))}
    </div>
  )
}