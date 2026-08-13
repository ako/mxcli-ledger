# Feedback

- **Widget ID:** `com.mendix.widget.native.feedback.Feedback`
- **Type:** PLUGGABLEWIDGET
- **Version:** 3.6.1

## MDL Example

```sql
PLUGGABLEWIDGET 'com.mendix.widget.native.feedback.Feedback' widget1
```

## Properties

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `sprintrapp` | string | Yes |  | The App ID is a hash that uniquely identifies your app project. You can find ... |
| `allowScreenshot` | boolean | Yes | true | If you are not allowed to send screenshots when submitting feedback for legal... |
| `logo` | image |  |  | For customized branding, add a logo to the widget. The recommended size of th... |
| `titleSendFeedback` | textTemplate |  |  | Title shown when composing feedback |
| `titleSending` | textTemplate |  |  | Title shown while sending feedback |
| `titleResult` | textTemplate |  |  | Title shown in result dialogs (success/error) |
| `labelFeedbackInput` | textTemplate |  |  | Visible label shown above the feedback text field |
| `labelIncludeScreenshot` | textTemplate |  |  | Label for screenshot toggle switch |
| `buttonCancel` | textTemplate |  |  | Label for cancel button |
| `buttonSend` | textTemplate |  |  | Label for send button |
| `buttonOk` | textTemplate |  |  | Label for OK button in result dialogs |
| `accessibilityLabelFeedbackButton` | textTemplate |  |  | Label announced by screen readers for the feedback button (not visible on scr... |
| `messageSuccess` | textTemplate |  |  | Message shown when feedback is sent successfully |
| `messageError` | textTemplate |  |  | Message shown when feedback fails to send |

