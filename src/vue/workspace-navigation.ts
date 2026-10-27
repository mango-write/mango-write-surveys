export interface SurveyStageNavigationItem {
  id: string;
  label: string;
  meta?: string;
  active?: boolean;
}

export interface SurveyStageNavigationGroup {
  id: string;
  label?: string;
  items: SurveyStageNavigationItem[];
}

export interface SurveyStageNavigation {
  title: string;
  actionId?: string;
  actionLabel?: string;
  groups: SurveyStageNavigationGroup[];
}
