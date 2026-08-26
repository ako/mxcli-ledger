# Gallery

- **Widget ID:** `com.mendix.widget.web.gallery.Gallery`
- **Type:** PLUGGABLEWIDGET
- **Version:** 3.11.3

## MDL Example

```sql
PLUGGABLEWIDGET 'com.mendix.widget.web.gallery.Gallery' widget1 {
  template {
    -- widgets for `content`
  }
  emptyplaceholder {
    -- widgets for `emptyPlaceholder`
  }
  filter {
    -- widgets for `filtersPlaceholder`
  }
}
```

## Properties

| Property | Type | Required | Default | Values / notes | Group | Description |
|----------|------|----------|---------|----------------|-------|-------------|
| `filtersPlaceholder` | widgets |  |  |  | General::General | Filters placeholder |
| `content` | widgets |  |  |  | General::General | Content placeholder |
| `datasource` | datasource | Yes |  | list | General::General | Data source |
| `refreshInterval` | integer | Yes | 0 |  | General::General | Refresh time (in seconds) |
| `desktopItems` | integer | Yes | 1 |  | General::Columns | Desktop columns |
| `tabletItems` | integer | Yes | 1 |  | General::Columns | Tablet columns |
| `phoneItems` | integer | Yes | 1 |  | General::Columns | Phone columns |
| `onClickTrigger` | enumeration | Yes | single | `single` \| `double` | General::Events | On click trigger |
| `onClick` | action |  |  |  | General::Events | On click action |
| `onSelectionChange` | action |  |  |  | General::Events | On selection change |
| `itemSelection` | selection | Yes |  |  | Behavior::Selection | Selection |
| `autoSelect` | boolean | Yes | false |  | Behavior::Selection | Automatically select the first item |
| `itemSelectionMode` | enumeration | Yes | clear | `toggle` \| `clear` | Behavior::Selection | Defines item selection behavior. |
| `keepSelection` | boolean | Yes | false |  | Behavior::Selection | If enabled, selected items will stay selected unless cleared by the user or a Nanoflow. |
| `selectionCountPosition` | enumeration | Yes | bottom | `top` \| `bottom` \| `off` | Behavior::Selection | Show selection count |
| `loadingType` | enumeration | Yes | spinner | `spinner` \| `skeleton` | Behavior::Loading state | Loading type |
| `refreshIndicator` | boolean | Yes | false |  | Behavior::Loading state | Show a refresh indicator when the data is being loaded. |
| `pageSize` | integer | Yes | 20 |  | Behavior::Pagination | Page size |
| `pagination` | enumeration | Yes | buttons | `buttons` \| `virtualScrolling` \| `loadMore` | Behavior::Pagination | Pagination |
| `useCustomPagination` | boolean | Yes | false |  | Behavior::Pagination | Custom pagination |
| `customPagination` | widgets |  |  |  | Behavior::Pagination | Custom pagination |
| `showPagingButtons` | enumeration | Yes | always | `always` \| `auto` | Behavior::Pagination | Show paging buttons |
| `showTotalCount` | boolean | Yes | false |  | Behavior::Pagination | Show total count |
| `pagingPosition` | enumeration | Yes | bottom | `bottom` \| `top` \| `both` | Behavior::Pagination | Position of pagination |
| `loadMoreButtonCaption` | textTemplate |  |  |  | Behavior::Pagination | Load more caption |
| `dynamicPageSize` | attribute |  |  |  | Behavior::Pagination | Attribute to set the page size dynamically. |
| `dynamicPage` | attribute |  |  |  | Behavior::Pagination | Attribute to set the page dynamically. |
| `totalCountValue` | attribute |  |  |  | Behavior::Pagination | Attribute to store current total count |
| `dynamicItemCount` | attribute |  |  |  | Behavior::Pagination | Read-only attribute reflecting the number of items currently loaded. |
| `showEmptyPlaceholder` | enumeration | Yes | none | `none` \| `custom` | Behavior::Appearance | Empty message |
| `emptyPlaceholder` | widgets |  |  |  | Behavior::Appearance | Empty placeholder |
| `itemClass` | expression |  |  |  | Behavior::Appearance | Dynamic item class |
| `customItemKey` | expression |  |  |  | Behavior::Advanced | Stable identifier for items to maintain scroll position when using view entities. |
| `stateStorageType` | enumeration | Yes | attribute | `attribute` \| `localStorage` | Personalization::Configuration | When Browser local storage is selected, the configuration is scoped to a browser profile. This configuration is not tied to a Mendix user. |
| `stateStorageAttr` | attribute |  |  | on change → `onConfigurationChange` | Personalization::Configuration | Attribute containing the personalized configuration of the capabilities. This configuration is automatically stored and loaded. The attribute requires Unlimited String. |
| `onConfigurationChange` | action |  |  |  | Personalization::Configuration | On change |
| `storeFilters` | boolean | Yes | true |  | Personalization::Configuration | Store filters |
| `storeSort` | boolean | Yes | true |  | Personalization::Configuration | Store sort |
| `filterSectionTitle` | textTemplate |  |  |  | Texts::Aria labels | Assistive technology will read this upon reaching a filtering or sorting section. |
| `emptyMessageTitle` | textTemplate |  |  |  | Texts::Aria labels | Assistive technology will read this upon reaching an empty message section. |
| `ariaLabelListBox` | textTemplate |  |  |  | Texts::Aria labels | Assistive technology will read this upon reaching gallery. |
| `ariaLabelItem` | textTemplate |  |  |  | Texts::Aria labels | Assistive technology will read this upon reaching each gallery item. |
| `selectedCountTemplateSingular` | textTemplate |  |  |  | Texts::Captions | Must include '%d' to denote number position |
| `selectedCountTemplatePlural` | textTemplate |  |  |  | Texts::Captions | Must include '%d' to denote number position |
| `clearSelectionButtonLabel` | textTemplate |  |  |  | Texts::Captions | Customize the label of the 'Clear section' button |

## Child Slots (curly-brace blocks)

| MDL keyword | Widget property |
|-------------|----------------|
| `template` | `content` |
| `emptyplaceholder` | `emptyPlaceholder` |
| `filter` | `filtersPlaceholder` |

---

Regenerated by `mxcli widget docs` and by `refresh catalog`. For the same data live from the `.mpk` — including anything added by a widget upgrade since this file was written — run `mxcli widget describe gallery -p <app.mpr>`.
