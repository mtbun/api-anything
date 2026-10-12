// The subset of the HAR 1.2 format that api-anything reads.
// Spec: http://www.softwareishard.com/blog/har-12-spec/

export interface HarNameValue {
  name: string;
  value: string;
}

export interface HarPostData {
  mimeType?: string;
  text?: string;
  params?: { name: string; value?: string }[];
}

export interface HarRequest {
  method: string;
  url: string;
  headers: HarNameValue[];
  queryString?: HarNameValue[];
  postData?: HarPostData;
}

export interface HarContent {
  mimeType?: string;
  text?: string;
  encoding?: string;
}

export interface HarResponse {
  status: number;
  headers: HarNameValue[];
  content: HarContent;
}

export interface HarEntry {
  startedDateTime?: string;
  request: HarRequest;
  response: HarResponse;
  _resourceType?: string;
}

export interface Har {
  log: {
    version?: string;
    entries: HarEntry[];
  };
}
