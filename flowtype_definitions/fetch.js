// this part of spec is not finished yet
// I made this stackoverflow question
// https://stackoverflow.com/questions/35296664/can-fetch-get-object-as-headers

type HeadersInit = string | Headers | {[key: string]: string};

declare class Headers {
  constructor(init?: HeadersInit): void;
  append(name: string, value: string): void;
  delete(name: string): void;
  entries(): Iterator<[string, string]>;
  get(name: string): string;
  getAll(name: string): Array<string>;
  has(name: string): boolean;
  keys(): Iterator<string>;
  set(name: string, value: string): void;
  values(): Iterator<string>; 
}

declare class URLSearchParams {
  constuctor(query: string): void;
  append(name: string, value: string): void;
  delete(name: string): void;
  entries(): Iterator<[string, string]>;
  get(name: string): string;
  getAll(name: string): Array<string>;
  has(name: string): boolean;
  keys(): Iterator<string>;
  set(name: string, value: string): void;
  values(): Iterator<string>; 
}

type RequestOptions = {
  body?: Blob | FormData | URLSearchParams | string;

  cache?: 'default' | 'no-store' | 'reload' | 'no-cache' | 'force-cache' | 'only-if-cached';
  credentials?: 'omit' | 'same-origin' | 'include';
  headers?: HeadersInit; 
  integrity?: string;
  method?: 'GET' | 'POST';
  mode?: 'cors' | 'no-cors' | 'same-origin';
  redirect?: 'follow' | 'error' | 'manual';
  referrer?: string
}

declare class Body {
  bodyUsed: boolean;

  arrayBuffer(): Promise<ArrayBuffer>;
  blob(): Promise<Blob>;
  formData(): Promise<FormData>;
  json(): Promise<Object>;
  text(): Promise<string>;
}

type ResponseOptions = {
  status?: number;
  statusText?: string;
  headers?: HeadersInit
}

declare class Response mixins Body {
  constructor(input: string | URLSearchParams | FormData | Blob, init: ResponseOptions): void;
  clone(): Response;
  error(): Response;
  redirect(url: string, status: number): Response;

  type: string;
  url: string;
  useFinalUrl: boolean;
  status: number;
  ok: boolean;
  statusText: string;
  headers: Headers;
}

declare class Request mixins Body {
  constructor(input: string | Request, init?: RequestOptions): void;
  clone(): Request;

  url: string;  

  cache: 'default' | 'no-store' | 'reload' | 'no-cache' | 'force-cache' | 'only-if-cached';
  credentials: 'omit' | 'same-origin' | 'include';
  headers: Headers;
  integrity: string;
  method: 'GET' | 'POST';
  mode: 'cors' | 'no-cors' | 'same-origin';
  redirect: 'follow' | 'error' | 'manual';
  referrer: string;
}

declare function fetch(input: string | Request, init?: RequestOptions): Promise<Response>; 
