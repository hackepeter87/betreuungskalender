{{- define "betreuungskalender.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "betreuungskalender.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "betreuungskalender.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "betreuungskalender.labels" -}}
helm.sh/chart: {{ include "betreuungskalender.chart" . }}
{{ include "betreuungskalender.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ default .Chart.AppVersion .Values.image.tag | quote }}
{{- with .Values.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{- define "betreuungskalender.image" -}}
{{- if .Values.image.digest -}}
{{- printf "%s@%s" .Values.image.repository .Values.image.digest -}}
{{- else -}}
{{- printf "%s:%s" .Values.image.repository (default .Chart.AppVersion .Values.image.tag) -}}
{{- end -}}
{{- end }}

{{- define "betreuungskalender.selectorLabels" -}}
app.kubernetes.io/name: {{ include "betreuungskalender.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "betreuungskalender.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "betreuungskalender.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{- define "betreuungskalender.dataClaimName" -}}
{{- default (printf "%s-data" (include "betreuungskalender.fullname" .)) .Values.persistence.data.existingClaim }}
{{- end }}

{{- define "betreuungskalender.backupClaimName" -}}
{{- default (printf "%s-backups" (include "betreuungskalender.fullname" .)) .Values.persistence.backups.existingClaim }}
{{- end }}

{{- define "betreuungskalender.postgresEvaluationName" -}}
{{- printf "%s-postgres-evaluation" (include "betreuungskalender.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "betreuungskalender.postgresEvaluationClaimName" -}}
{{- default (printf "%s-data" (include "betreuungskalender.postgresEvaluationName" .)) .Values.database.embeddedEvaluation.persistence.existingClaim }}
{{- end }}

{{- define "betreuungskalender.postgresEvaluationSelectorLabels" -}}
app.kubernetes.io/name: {{ printf "%s-postgres-evaluation" (include "betreuungskalender.name" .) | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "betreuungskalender.postgresEvaluationLabels" -}}
helm.sh/chart: {{ include "betreuungskalender.chart" . }}
{{ include "betreuungskalender.postgresEvaluationSelectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ .Values.database.embeddedEvaluation.image.tag | quote }}
app.kubernetes.io/component: database-evaluation
{{- end }}

{{- define "betreuungskalender.postgresHost" -}}
{{- if eq .Values.database.type "postgres-embedded-evaluation" -}}
{{- include "betreuungskalender.postgresEvaluationName" . -}}
{{- else -}}
{{- .Values.database.postgres.host -}}
{{- end -}}
{{- end }}
