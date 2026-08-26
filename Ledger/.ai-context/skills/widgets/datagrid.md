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

| Property | Type | Required | Default | Values / notes | Group | Description |
|----------|------|----------|---------|----------------|-------|-------------|
| `datasource` | datasource | Yes |  | list | General::General | Data source |
| `refreshInterval` | integer | Yes | 0 |  | General::General | Refresh time (in seconds) |
| `columns` | object | Yes |  | list; 24 sub-properties below | General::Columns | Columns |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ `showContentAs` | enumeration | Yes | attribute | `attribute` \| `dynamicText` \| `customContent` |  | Show |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ `attribute` | attribute |  |  |  |  | Attribute is required if the column can be sorted or filtered |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ `content` | widgets |  |  |  |  | Custom content |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ `dynamicText` | textTemplate |  |  |  |  | Dynamic text |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ `exportValue` | textTemplate |  |  |  |  | Export value |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ `exportType` | enumeration | Yes | default | `default` \| `number` \| `date` \| `boolean` |  | Export type |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ `exportNumberFormat` | expression |  |  |  |  | Optional Excel number format for exported numeric values (e.g. "#,##0.00", "$0.00", "0.00%"). See all formats https://docs.sheetjs.com/docs/csf/features/nf/ |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ `exportDateFormat` | expression |  |  |  |  | Excel date format for exported Date/DateTime values (e.g. "yyyy-mm-dd", "dd/mm/yyyy hh mm"). |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ `header` | textTemplate |  |  |  |  | Caption |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ `tooltip` | textTemplate |  |  |  |  | Tooltip |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ `filter` | widgets |  |  |  |  | Filter |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ `visible` | expression | Yes | true |  |  | Visible |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ `sortable` | boolean | Yes | true |  |  | Can sort |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ `resizable` | boolean | Yes | true |  |  | Can resize |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ `draggable` | boolean | Yes | true |  |  | Can reorder |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ `hidable` | enumeration | Yes | yes | `yes` \| `hidden` \| `no` |  | Can hide |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ `allowEventPropagation` | boolean | Yes | true |  |  | If set to yes, then all default events on the row, such as "on click" or selection, will be triggered when the user interacts with custom content. |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ `width` | enumeration | Yes | autoFill | `autoFill` \| `autoFit` \| `manual` |  | Column width |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ `minWidth` | enumeration | Yes | auto | `auto` \| `minContent` \| `manual` |  | Min width |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ `minWidthLimit` | integer | Yes | 100 |  |  | Min width value (px) |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ `size` | integer | Yes | 1 |  |  | Column size |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ `alignment` | enumeration | Yes | left | `left` \| `center` \| `right` |  | Alignment |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ `columnClass` | expression |  |  |  |  | Dynamic cell class |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ `wrapText` | boolean | Yes | false |  |  | Wrap text |
| `columnsFilterable` | boolean | Yes | true |  | General::Columns | Show column filters |
| `onClickTrigger` | enumeration | Yes | single | `single` \| `double` | General::Events | On click trigger |
| `onClick` | action |  |  |  | General::Events | On click action |
| `onSelectionChange` | action |  |  |  | General::Events | On selection change |
| `filtersPlaceholder` | widgets |  |  |  | General::Events | Filters placeholder |
| `itemSelection` | selection | Yes |  |  | Behavior::Selection | Selection |
| `itemSelectionMethod` | enumeration | Yes | checkbox | `checkbox` \| `rowClick` | Behavior::Selection | Selection method |
| `autoSelect` | boolean | Yes | false |  | Behavior::Selection | Automatically select the first row |
| `itemSelectionMode` | enumeration | Yes | clear | `toggle` \| `clear` | Behavior::Selection | Defines item selection behavior. |
| `showSelectAllToggle` | boolean | Yes | true |  | Behavior::Selection | Displays a checkbox in the grid header that allows selecting or deselecting all rows on the current page. |
| `enableSelectAll` | boolean | Yes | false |  | Behavior::Selection | Shows a banner with the option to select all rows across all pages when all rows on the current page are selected. |
| `keepSelection` | boolean | Yes | false |  | Behavior::Selection | If enabled, selected items will stay selected unless cleared by the user or a Nanoflow. |
| `selectionCounterPosition` | enumeration | Yes | bottom | `top` \| `bottom` \| `off` | Behavior::Selection | Show selection count |
| `loadingType` | enumeration | Yes | spinner | `spinner` \| `skeleton` | Behavior::Loading state | Loading type |
| `refreshIndicator` | boolean | Yes | false |  | Behavior::Loading state | Show a refresh indicator when the data is being loaded. |
| `pageSize` | integer | Yes | 20 |  | Behavior::Pagination | Page size |
| `pagination` | enumeration | Yes | buttons | `buttons` \| `virtualScrolling` \| `loadMore` | Behavior::Pagination | Pagination |
| `useCustomPagination` | boolean | Yes | false |  | Behavior::Pagination | Custom pagination |
| `customPagination` | widgets |  |  |  | Behavior::Pagination | Custom pagination |
| `showPagingButtons` | enumeration | Yes | always | `always` \| `auto` | Behavior::Pagination | Show paging buttons |
| `showNumberOfRows` | boolean | Yes | false |  | Behavior::Pagination | Show number of rows |
| `pagingPosition` | enumeration | Yes | bottom | `bottom` \| `top` \| `both` | Behavior::Pagination | Position of pagination |
| `loadMoreButtonCaption` | textTemplate |  |  |  | Behavior::Pagination | Load more caption |
| `dynamicPageSize` | attribute |  |  |  | Behavior::Pagination | Attribute to set the page size dynamically. |
| `dynamicPage` | attribute |  |  |  | Behavior::Pagination | Attribute to set the page dynamically. |
| `totalCountValue` | attribute |  |  |  | Behavior::Pagination | Attribute to store current total count |
| `dynamicItemCount` | attribute |  |  |  | Behavior::Pagination | Read-only attribute reflecting the number of rows currently loaded. |
| `showEmptyPlaceholder` | enumeration | Yes | none | `none` \| `custom` | Behavior::Appearance | Empty list message |
| `emptyPlaceholder` | widgets |  |  |  | Behavior::Appearance | Empty placeholder |
| `rowClass` | expression |  |  |  | Behavior::Appearance | Dynamic row class |
| `customRowKey` | expression |  |  |  | Behavior::Advanced | Stable identifier for rows to maintain scroll position when using view entities. |
| `columnsSortable` | boolean | Yes | true |  | Personalization::Column capabilities | Enable sorting for all columns unless specified otherwise in the column setting |
| `columnsResizable` | boolean | Yes | true |  | Personalization::Column capabilities | Enable resizing for all columns unless specified otherwise in the column setting |
| `columnsDraggable` | boolean | Yes | true |  | Personalization::Column capabilities | Enable reordering for all columns unless specified otherwise in the column setting |
| `columnsHidable` | boolean | Yes | true |  | Personalization::Column capabilities | Enable hiding for all columns unless specified otherwise in the column setting |
| `configurationStorageType` | enumeration | Yes | attribute | `attribute` \| `localStorage` | Personalization::Configuration | When Browser local storage is selected, the configuration is scoped to a browser profile. This configuration is not tied to a Mendix user. |
| `configurationAttribute` | attribute |  |  | on change → `onConfigurationChange` | Personalization::Configuration | Attribute containing the personalized configuration of the capabilities. This configuration is automatically stored and loaded. The attribute requires Unlimited String. |
| `storeFiltersInPersonalization` | boolean | Yes | true |  | Personalization::Configuration | Store filters |
| `onConfigurationChange` | action |  |  |  | Personalization::Configuration | On change |
| `filterSectionTitle` | textTemplate |  |  |  | Texts::Aria labels | Assistive technology will read this upon reaching a filtering or sorting section. |
| `exportDialogLabel` | textTemplate |  |  |  | Texts::Aria labels | Assistive technology will read this upon reaching a export dialog. |
| `cancelExportLabel` | textTemplate |  |  |  | Texts::Aria labels | Assistive technology will read this upon reaching a cancel button. |
| `selectRowLabel` | textTemplate |  |  |  | Texts::Aria labels | If selection is enabled, assistive technology will read this upon reaching a checkbox. |
| `selectAllRowsLabel` | textTemplate |  |  |  | Texts::Aria labels | If selection is enabled, assistive technology will read this upon reaching 'Select all' checkbox. |
| `singleSelectionColumnLabel` | textTemplate |  |  |  | Texts::Aria labels | If single selection is enabled, assistive technology will read this for the selection column header. |
| `selectingAllLabel` | textTemplate |  |  |  | Texts::Aria labels | ARIA label for the progress dialog when selecting all items |
| `cancelSelectionLabel` | textTemplate |  |  |  | Texts::Aria labels | ARIA label for the cancel button in the selection progress dialog |
| `selectedCountTemplateSingular` | textTemplate |  |  |  | Texts::Captions | Must include '%d' to denote number position |
| `selectedCountTemplatePlural` | textTemplate |  |  |  | Texts::Captions | Must include '%d' to denote number position |
| `selectAllText` | textTemplate | Yes |  |  | Texts::Captions | Select all text |
| `selectAllTemplate` | textTemplate | Yes |  |  | Texts::Captions | This caption used when total count is available. |
| `allSelectedText` | textTemplate | Yes |  |  | Texts::Captions | Select status template |
| `clearSelectionButtonLabel` | textTemplate |  |  |  | Texts::Captions | Customize the label of the 'Clear section' button |

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

---

Regenerated by `mxcli widget docs` and by `refresh catalog`. For the same data live from the `.mpk` — including anything added by a widget upgrade since this file was written — run `mxcli widget describe datagrid -p <app.mpr>`.
