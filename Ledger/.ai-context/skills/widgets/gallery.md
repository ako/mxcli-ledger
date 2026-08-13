# Gallery

- **Widget ID:** `com.mendix.widget.web.gallery.Gallery`
- **Type:** PLUGGABLEWIDGET
- **Version:** 3.11.3

## MDL Example

```sql
PLUGGABLEWIDGET 'com.mendix.widget.web.gallery.Gallery' widget1
```

## Properties

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `filtersPlaceholder` | widgets |  |  |  |
| `content` | widgets |  |  |  |
| `datasource` | datasource | Yes |  |  |
| `refreshInterval` | integer | Yes | 0 |  |
| `desktopItems` | integer | Yes | 1 |  |
| `tabletItems` | integer | Yes | 1 |  |
| `phoneItems` | integer | Yes | 1 |  |
| `onClickTrigger` | enumeration | Yes | single |  |
| `onClick` | action |  |  |  |
| `onSelectionChange` | action |  |  |  |
| `itemSelection` | selection | Yes |  |  |
| `autoSelect` | boolean | Yes | false | Automatically select the first item |
| `itemSelectionMode` | enumeration | Yes | clear | Defines item selection behavior. |
| `keepSelection` | boolean | Yes | false | If enabled, selected items will stay selected unless cleared by the user or a... |
| `selectionCountPosition` | enumeration | Yes | bottom |  |
| `loadingType` | enumeration | Yes | spinner |  |
| `refreshIndicator` | boolean | Yes | false | Show a refresh indicator when the data is being loaded. |
| `pageSize` | integer | Yes | 20 |  |
| `pagination` | enumeration | Yes | buttons |  |
| `useCustomPagination` | boolean | Yes | false |  |
| `customPagination` | widgets |  |  |  |
| `showPagingButtons` | enumeration | Yes | always |  |
| `showTotalCount` | boolean | Yes | false |  |
| `pagingPosition` | enumeration | Yes | bottom |  |
| `loadMoreButtonCaption` | textTemplate |  |  |  |
| `dynamicPageSize` | attribute |  |  | Attribute to set the page size dynamically. |
| `dynamicPage` | attribute |  |  | Attribute to set the page dynamically. |
| `totalCountValue` | attribute |  |  | Attribute to store current total count |
| `dynamicItemCount` | attribute |  |  | Read-only attribute reflecting the number of items currently loaded. |
| `showEmptyPlaceholder` | enumeration | Yes | none |  |
| `emptyPlaceholder` | widgets |  |  |  |
| `itemClass` | expression |  |  |  |
| `customItemKey` | expression |  |  | Stable identifier for items to maintain scroll position when using view entit... |
| `stateStorageType` | enumeration | Yes | attribute | When Browser local storage is selected, the configuration is scoped to a brow... |
| `stateStorageAttr` | attribute |  |  | Attribute containing the personalized configuration of the capabilities. This... |
| `onConfigurationChange` | action |  |  |  |
| `storeFilters` | boolean | Yes | true |  |
| `storeSort` | boolean | Yes | true |  |
| `filterSectionTitle` | textTemplate |  |  | Assistive technology will read this upon reaching a filtering or sorting sect... |
| `emptyMessageTitle` | textTemplate |  |  | Assistive technology will read this upon reaching an empty message section. |
| `ariaLabelListBox` | textTemplate |  |  | Assistive technology will read this upon reaching gallery. |
| `ariaLabelItem` | textTemplate |  |  | Assistive technology will read this upon reaching each gallery item. |
| `selectedCountTemplateSingular` | textTemplate |  |  | Must include '%d' to denote number position |
| `selectedCountTemplatePlural` | textTemplate |  |  | Must include '%d' to denote number position |
| `clearSelectionButtonLabel` | textTemplate |  |  | Customize the label of the 'Clear section' button |

