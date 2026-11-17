import { execFile } from 'node:child_process'

export function runProcess(file, args = [], options = {}) {
  const finalOptions = { windowsHide: true, ...options }
  if (process.platform === 'win32' && /\.cmd$/i.test(file)) {
    return new Promise((resolve, reject) => {
      execFile(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'call', file, ...args], finalOptions, (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stdout, stderr }))
          return
        }
        resolve({ stdout, stderr })
      })
    })
  }
  return new Promise((resolve, reject) => {
    execFile(file, args, finalOptions, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}
