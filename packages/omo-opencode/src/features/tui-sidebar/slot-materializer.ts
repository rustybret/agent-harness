import type { ViewNode } from "./element-helpers"

export type SolidRuntime<Node> = {
  readonly createElement: (tag: string) => Node
  readonly insert: (parent: Node, child: Node | string) => unknown
  readonly setProp: (node: Node, name: string, value: unknown) => unknown
}

export function materialize<Node>(nodes: readonly ViewNode[], solid: SolidRuntime<Node>): Node {
  const root = solid.createElement("box")
  solid.setProp(root, "flexDirection", "column")
  for (const node of nodes) {
    solid.insert(root, materializeNode(node, solid))
  }
  return root
}

export function materializeNode<Node>(node: ViewNode, solid: SolidRuntime<Node>): Node {
  const element = solid.createElement(node.kind)
  for (const [name, value] of Object.entries(node.props)) {
    solid.setProp(element, name, value)
  }
  if (node.kind === "text") {
    solid.insert(element, node.text ?? "")
  }
  for (const child of node.children ?? []) {
    solid.insert(element, materializeNode(child, solid))
  }
  return element
}
