import axios, { type AxiosInstance } from 'axios'

export const HTTP_TIMEOUT = 15_000

export function createHttpClient(): AxiosInstance {
  return axios.create({
    timeout: HTTP_TIMEOUT,
  })
}
