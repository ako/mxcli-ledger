# Tree node

- **Widget ID:** `com.mendix.widget.web.treenode.TreeNode`
- **Type:** PLUGGABLEWIDGET
- **Version:** 3.11.3

## MDL Example

```sql
PLUGGABLEWIDGET 'com.mendix.widget.web.treenode.TreeNode' widget1 {
  headercontent {
    -- widgets for `headerContent`
  }
  children {
    -- widgets for `children`
  }
}
```

## Properties

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `advancedMode` | boolean | Yes | false |  |
| `datasource` | datasource | Yes |  |  |
| `parentAssociation` | association |  |  | Select the self-referencing association that connects each item to its parent... |
| `headerType` | enumeration | Yes | text |  |
| `openNodeOn` | enumeration | Yes | headerClick | Define which part of the node, when clicked, should open or close this node. ... |
| `headerContent` | widgets |  |  |  |
| `headerCaption` | textTemplate |  |  |  |
| `hasChildren` | expression | Yes |  | Indicate whether the node has children or is an end node. When set to yes, a ... |
| `startExpanded` | boolean | Yes | false |  |
| `children` | widgets |  |  |  |
| `animate` | boolean | Yes | true |  |
| `showIcon` | enumeration | Yes | left |  |
| `expandedIcon` | icon |  |  |  |
| `collapsedIcon` | icon |  |  |  |
| `animateIcon` | boolean | Yes | true | Animate the icon when the group is collapsing or expanding. |
| `noDataMessage` | textTemplate |  |  | Message to show when there are no items to display. |

## Child Slots (curly-brace blocks)

| MDL keyword | Widget property |
|-------------|----------------|
| `headercontent` | `headerContent` |
| `children` | `children` |

