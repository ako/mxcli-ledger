# Data grid 2

- **Widget ID:** `com.mendix.widget.web.datagrid.Datagrid`
- **Type:** PLUGGABLEWIDGET
- **Version:** 3.11.3

## MDL Example

```sql
PLUGGABLEWIDGET 'com.mendix.widget.web.datagrid.Datagrid' widget1 {
  controlbar {
    -- widgets for `filtersPlaceholder`
  }
  custompagination {
    -- widgets for `customPagination`
  }
  emptyplaceholder {
    -- widgets for `emptyPlaceholder`
  }
  column item1   -- one entry of `columns`
}
```

## Properties

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `datasource` | datasource | Yes |  |  |
| `refreshInterval` | integer | Yes | 0 |  |
| `columns` | object | Yes |  |  |
| `columnsFilterable` | boolean | Yes | true |  |
| `onClickTrigger` | enumeration | Yes | single |  |
| `onClick` | action |  |  |  |
| `onSelectionChange` | action |  |  |  |
| `filtersPlaceholder` | widgets |  |  |  |
| `itemSelection` | selection | Yes |  |  |
| `itemSelectionMethod` | enumeration | Yes | checkbox |  |
| `autoSelect` | boolean | Yes | false | Automatically select the first row |
| `itemSelectionMode` | enumeration | Yes | clear | Defines item selection behavior. |
| `showSelectAllToggle` | boolean | Yes | true | Displays a checkbox in the grid header that allows selecting or deselecting a... |
| `enableSelectAll` | boolean | Yes | false | Shows a banner with the option to select all rows across all pages when all r... |
| `keepSelection` | boolean | Yes | false | If enabled, selected items will stay selected unless cleared by the user or a... |
| `selectionCounterPosition` | enumeration | Yes | bottom |  |
| `loadingType` | enumeration | Yes | spinner |  |
| `refreshIndicator` | boolean | Yes | false | Show a refresh indicator when the data is being loaded. |
| `pageSize` | integer | Yes | 20 |  |
| `pagination` | enumeration | Yes | buttons |  |
| `useCustomPagination` | boolean | Yes | false |  |
| `customPagination` | widgets |  |  |  |
| `showPagingButtons` | enumeration | Yes | always |  |
| `showNumberOfRows` | boolean | Yes | false |  |
| `pagingPosition` | enumeration | Yes | bottom |  |
| `loadMoreButtonCaption` | textTemplate |  |  |  |
| `dynamicPageSize` | attribute |  |  | Attribute to set the page size dynamically. |
| `dynamicPage` | attribute |  |  | Attribute to set the page dynamically. |
| `totalCountValue` | attribute |  |  | Attribute to store current total count |
| `dynamicItemCount` | attribute |  |  | Read-only attribute reflecting the number of rows currently loaded. |
| `showEmptyPlaceholder` | enumeration | Yes | none |  |
| `emptyPlaceholder` | widgets |  |  |  |
| `rowClass` | expression |  |  |  |
| `customRowKey` | expression |  |  | Stable identifier for rows to maintain scroll position when using view entities. |
| `columnsSortable` | boolean | Yes | true | Enable sorting for all columns unless specified otherwise in the column setting |
| `columnsResizable` | boolean | Yes | true | Enable resizing for all columns unless specified otherwise in the column setting |
| `columnsDraggable` | boolean | Yes | true | Enable reordering for all columns unless specified otherwise in the column se... |
| `columnsHidable` | boolean | Yes | true | Enable hiding for all columns unless specified otherwise in the column setting |
| `configurationStorageType` | enumeration | Yes | attribute | When Browser local storage is selected, the configuration is scoped to a brow... |
| `configurationAttribute` | attribute |  |  | Attribute containing the personalized configuration of the capabilities. This... |
| `storeFiltersInPersonalization` | boolean | Yes | true |  |
| `onConfigurationChange` | action |  |  |  |
| `filterSectionTitle` | textTemplate |  |  | Assistive technology will read this upon reaching a filtering or sorting sect... |
| `exportDialogLabel` | textTemplate |  |  | Assistive technology will read this upon reaching a export dialog. |
| `cancelExportLabel` | textTemplate |  |  | Assistive technology will read this upon reaching a cancel button. |
| `selectRowLabel` | textTemplate |  |  | If selection is enabled, assistive technology will read this upon reaching a ... |
| `selectAllRowsLabel` | textTemplate |  |  | If selection is enabled, assistive technology will read this upon reaching 'S... |
| `singleSelectionColumnLabel` | textTemplate |  |  | If single selection is enabled, assistive technology will read this for the s... |
| `selectingAllLabel` | textTemplate |  |  | ARIA label for the progress dialog when selecting all items |
| `cancelSelectionLabel` | textTemplate |  |  | ARIA label for the cancel button in the selection progress dialog |
| `selectedCountTemplateSingular` | textTemplate |  |  | Must include '%d' to denote number position |
| `selectedCountTemplatePlural` | textTemplate |  |  | Must include '%d' to denote number position |
| `selectAllText` | textTemplate | Yes |  |  |
| `selectAllTemplate` | textTemplate | Yes |  | This caption used when total count is available. |
| `allSelectedText` | textTemplate | Yes |  |  |
| `clearSelectionButtonLabel` | textTemplate |  |  | Customize the label of the 'Clear section' button |

## Child Slots (curly-brace blocks)

| MDL keyword | Widget property |
|-------------|----------------|
| `controlbar` | `filtersPlaceholder` |
| `custompagination` | `customPagination` |
| `emptyplaceholder` | `emptyPlaceholder` |

## Object Lists (repeating child entries)

### `column` → property `columns`

Item properties:

| Property | Operation |
|----------|-----------|
| `showContentAs` | primitive |
| `attribute` | attribute |
| `dynamicText` | texttemplate |
| `exportValue` | texttemplate |
| `exportType` | primitive |
| `exportNumberFormat` | expression |
| `exportDateFormat` | expression |
| `header` | texttemplate |
| `tooltip` | texttemplate |
| `visible` | expression |
| `sortable` | primitive |
| `resizable` | primitive |
| `draggable` | primitive |
| `hidable` | primitive |
| `allowEventPropagation` | primitive |
| `width` | primitive |
| `minWidth` | primitive |
| `minWidthLimit` | primitive |
| `size` | primitive |
| `alignment` | primitive |
| `columnClass` | expression |
| `wrapText` | primitive |

Item child slots:

| MDL keyword | Widget property |
|-------------|----------------|
| `content` | `content` |
| `filter` | `filter` |

